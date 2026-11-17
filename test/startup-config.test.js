// The server refuses to start with a missing, placeholder or short
// JWT_SECRET. The rule is tested as a function, and then for real by
// starting server/index.js as a child process (no database is needed to
// start: the pool connects only when queried). Each child is stopped by
// the test that started it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { jwtSecretProblem, JWT_SECRET_PLACEHOLDER, JWT_SECRET_MIN_LENGTH } = require('../server/config');

const INDEX = path.join(__dirname, '../server/index.js');
const GOOD = 'k'.repeat(32);

test('the rule: unset, placeholder and short secrets are problems; 32 characters is not', () => {
    assert.equal(JWT_SECRET_MIN_LENGTH, 32);
    assert.match(jwtSecretProblem({}), /^JWT_SECRET is not set\./);
    assert.match(jwtSecretProblem({ JWT_SECRET: '' }), /^JWT_SECRET is not set\./);
    assert.match(jwtSecretProblem({ JWT_SECRET: '   ' }), /^JWT_SECRET is not set\./);
    assert.match(jwtSecretProblem({ JWT_SECRET: JWT_SECRET_PLACEHOLDER }), /^JWT_SECRET is still the placeholder from \.env\.example\./);
    assert.match(jwtSecretProblem({ JWT_SECRET: 'k'.repeat(31) }), /^JWT_SECRET is too short: it must be at least 32 characters\./);
    assert.match(jwtSecretProblem({ JWT_SECRET: ' ' + 'k'.repeat(31) }), /too short/); // padding does not count
    assert.equal(jwtSecretProblem({ JWT_SECRET: GOOD }), null);
    assert.equal(jwtSecretProblem({ JWT_SECRET: 'k'.repeat(64) }), null);
});

test('the placeholder in the rule is the one .env.example ships', () => {
    const example = fs.readFileSync(path.join(__dirname, '../.env.example'), 'utf8');
    assert.ok(example.split('\n').includes(`JWT_SECRET=${JWT_SECRET_PLACEHOLDER}`));
});

test('the message names the variable and the rule and never contains the value', () => {
    for (const secret of ['h'.repeat(15), JWT_SECRET_PLACEHOLDER, 's'.repeat(27)]) {
        const problem = jwtSecretProblem({ JWT_SECRET: secret });
        assert.match(problem, /JWT_SECRET/);
        assert.ok(!problem.includes(secret), 'the value is not in the message');
        assert.ok(!problem.includes('\n'), 'one line');
    }
});

// Starts the real entry point in an empty directory (so no .env is read)
// with only the given variables. Resolves when it exits, or when it says
// it is running, in which case it is stopped.
function startServer(vars) {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'dati-start-'));
    const child = spawn(process.execPath, [INDEX], {
        cwd,
        env: { PATH: process.env.PATH, PORT: '0', ...vars },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let started = false;
    return new Promise((resolve) => {
        const giveUp = setTimeout(() => child.kill('SIGKILL'), 10000);
        child.stdout.on('data', (chunk) => {
            stdout += chunk;
            if (!started && stdout.includes('Backend running')) { started = true; child.kill(); }
        });
        child.stderr.on('data', (chunk) => { stderr += chunk; });
        child.on('close', (code, signal) => {
            clearTimeout(giveUp);
            fs.rmSync(cwd, { recursive: true, force: true });
            resolve({ code, signal, started, stdout, stderr });
        });
    });
}

const refusedCases = {
    'unset': {},
    'the .env.example placeholder': { JWT_SECRET: JWT_SECRET_PLACEHOLDER },
    '31 characters': { JWT_SECRET: 'q'.repeat(31) },
};
for (const [what, vars] of Object.entries(refusedCases)) {
    test(`the server does not start when JWT_SECRET is ${what}`, { timeout: 20000 }, async () => {
        const run = await startServer(vars);
        assert.equal(run.started, false, 'it never listened');
        assert.equal(run.code, 1);
        const lines = run.stderr.trim().split('\n');
        assert.equal(lines.length, 1, `one line on stderr, got: ${run.stderr}`);
        assert.match(lines[0], /^Refusing to start: JWT_SECRET /);
        if (vars.JWT_SECRET) assert.ok(!run.stderr.includes(vars.JWT_SECRET), 'the value is not printed');
        assert.equal(run.stdout, '');
    });
}

test('the server starts when JWT_SECRET is 32 characters', { timeout: 20000 }, async () => {
    const run = await startServer({ JWT_SECRET: GOOD });
    assert.equal(run.started, true, `it listened (stderr: ${run.stderr})`);
    assert.equal(run.signal, 'SIGTERM'); // stopped by this test, not by itself
    assert.ok(!run.stdout.includes(GOOD) && !run.stderr.includes(GOOD));
});
