// Express trusts X-Forwarded-For only from a loopback peer (a reverse
// proxy on the same machine), and the login limits count by the address
// that results. This loads the real app (server/index.js) with the
// in-memory fake database; every login here fails as "unknown user".
//
// What cannot be shown from here: a request arriving from a peer that is
// NOT loopback (the tests can only connect from loopback). That side is
// checked on Express's own trust function instead.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { installFakeDb } = require('./fake-db');

// Generated for each run: no secret is written in the tests.
process.env.JWT_SECRET = require('node:crypto').randomBytes(32).toString('hex');
installFakeDb();
const { app, server, io } = require('../server/index');

// Addresses from the ranges reserved for documentation.
const CLIENT_A = '203.0.113.10';
const CLIENT_B = '203.0.113.20';
const CLIENT_C = '203.0.113.30';
const CLIENT_D = '203.0.113.40';
const CLIENT_E = '203.0.113.50';
const SPOOFED = '198.51.100.99';

// Everything the server or the rate limiter logs as a warning or error.
const logged = [];
const realError = console.error;
const realWarn = console.warn;
console.log = () => {};
console.error = (...args) => logged.push(args.map(String).join(' '));
console.warn = (...args) => logged.push(args.map(String).join(' '));

// A test-only route that reports the address Express worked out.
app.post('/__probe/ip', (req, res) => res.json({ ip: req.ip }));

function post(path, body, forwardedFor) {
    const headers = { 'content-type': 'application/json', connection: 'close' };
    if (forwardedFor) headers['x-forwarded-for'] = forwardedFor;
    return new Promise((resolve, reject) => {
        const req = http.request(
            { host: '127.0.0.1', port: server.address().port, method: 'POST', path, headers },
            (res) => {
                let data = '';
                res.on('data', (c) => { data += c; });
                res.on('end', () => resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }));
            }
        );
        req.on('error', reject);
        req.end(JSON.stringify(body || {}));
    });
}
const login = (username, forwardedFor) => post('/api/auth/login', { username, password: 'wrong' }, forwardedFor);

test.before(() => new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)));
test.after(async () => {
    await new Promise((resolve) => io.close(resolve));
    console.error = realError;
    console.warn = realWarn;
});

test('trust proxy is loopback: loopback peers are trusted, other addresses are not', () => {
    assert.equal(app.get('trust proxy'), 'loopback');
    const trusted = app.get('trust proxy fn');
    assert.equal(trusted('127.0.0.1', 0), true);
    assert.equal(trusted('::1', 0), true);
    assert.equal(trusted(CLIENT_A, 0), false);
    assert.equal(trusted('2001:db8::10', 0), false);  // nor an IPv6 peer that is not loopback
});

test('req.ip follows X-Forwarded-For from a loopback peer, and only the hop loopback vouches for', async () => {
    const direct = await post('/__probe/ip');
    assert.match(direct.body.ip, /^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/);

    const proxied = await post('/__probe/ip', {}, CLIENT_A);
    assert.equal(proxied.body.ip, CLIENT_A);

    // A client behind the proxy sends its own X-Forwarded-For; the proxy
    // appends the address it really saw. The made-up entry is ignored.
    const spoofed = await post('/__probe/ip', {}, `${SPOOFED}, ${CLIENT_A}`);
    assert.equal(spoofed.body.ip, CLIENT_A);
});

test('the per-client login limit counts by the forwarded address', async () => {
    const { MAX_PER_CLIENT } = require('../server/middleware/loginLimit');
    for (let i = 0; i < MAX_PER_CLIENT; i++) {
        assert.equal((await login('guess-' + i, CLIENT_A)).status, 401, `attempt ${i + 1}`);
    }
    assert.equal((await login('one-more', CLIENT_A)).status, 429);
    // Another client behind the same proxy, and a direct client, are not affected.
    assert.equal((await login('one-more', CLIENT_B)).status, 401);
    assert.equal((await login('one-more')).status, 401);
    // Adding a made-up first hop does not give the limited client a fresh counter.
    assert.equal((await login('one-more', `${SPOOFED}, ${CLIENT_A}`)).status, 429);
});

test('the username limit is per client address: one address cannot lock an account for another', async () => {
    const { MAX_PER_USERNAME } = require('../server/middleware/loginLimit');
    // Client C uses up its tries for "admin" and is cut off...
    for (let i = 0; i < MAX_PER_USERNAME; i++) {
        assert.equal((await login('admin', CLIENT_C)).status, 401, `attempt ${i + 1}`);
    }
    assert.equal((await login('admin', CLIENT_C)).status, 429);
    assert.equal((await login('ADMIN', CLIENT_C)).status, 429);
    // ...but client D can still try "admin", and gets its own full allowance.
    for (let i = 0; i < MAX_PER_USERNAME; i++) {
        assert.equal((await login('admin', CLIENT_D)).status, 401, `other client, attempt ${i + 1}`);
    }
    assert.equal((await login('admin', CLIENT_D)).status, 429);
    // Client C is only cut off for that username.
    assert.equal((await login('host1', CLIENT_C)).status, 401);
});

test('the per-client limit still cuts an address off across usernames', async () => {
    const { MAX_PER_CLIENT } = require('../server/middleware/loginLimit');
    for (let i = 0; i < MAX_PER_CLIENT; i++) {
        assert.equal((await login('name-' + i, CLIENT_E)).status, 401, `attempt ${i + 1}`);
    }
    // A username this address never tried is refused: the address is over its limit.
    assert.equal((await login('fresh-name', CLIENT_E)).status, 429);
    assert.equal((await login('fresh-name', CLIENT_D)).status, 401);
});

test('the rate limiter raised no validation warning about trust proxy or X-Forwarded-For', async () => {
    await login('warning-check', CLIENT_B);
    const warnings = logged.filter((line) => /ERR_ERL|ValidationError|trust proxy|X-Forwarded-For/i.test(line));
    assert.deepEqual(warnings, []);
});
