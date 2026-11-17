// Login attempts are limited per client address and per username. The
// real route is used with its real limits; the DB pool is stubbed, so no
// MySQL is needed. Each test loads a fresh copy of the route, so the
// in-memory counters start at zero.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const bcrypt = require('bcrypt');
const { MAX_PER_CLIENT, MAX_PER_USERNAME, usernameKey } = require('../server/middleware/loginLimit');

// Generated for each run: no secret is written in the tests.
process.env.JWT_SECRET = require('node:crypto').randomBytes(32).toString('hex');

// One account, "host1"; every other username is unknown. Like mysql2 with
// the table's collation, the stub matches a one-element array to its
// element and ignores case and accents.
const plain = (v) => String(v).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
let queries = 0;
const GOOD_PASSWORD = require('node:crypto').randomBytes(12).toString('hex');
const hash = bcrypt.hashSync(GOOD_PASSWORD, 4);
const dbPath = require.resolve(path.join(__dirname, '../server/db'));
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true,
  exports: {
    query: async (_sql, params) => { queries++; return [
      plain(params[0]) === 'host1'
        ? [{ id: 2, username: 'host1', display_name: 'Trivia Host', role: 'host', password_hash: hash }]
        : [],
    ]; },
  },
};

async function start(t) {
  const routePath = require.resolve('../server/routes/auth');
  delete require.cache[routePath];
  const app = express();
  app.use(express.json());
  app.use('/api/auth', require(routePath));
  const server = app.listen(0, '127.0.0.1');
  t.after(() => server.close());
  await new Promise((r) => server.once('listening', r));
  const url = `http://127.0.0.1:${server.address().port}/api/auth/login`;
  return async (username, password) => {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', connection: 'close' },
      body: JSON.stringify({ username, password }),
    });
    return { status: r.status, body: await r.json() };
  };
}

test('the limits are small enough to matter', () => {
  assert.ok(MAX_PER_USERNAME >= 3 && MAX_PER_USERNAME <= 10);
  assert.ok(MAX_PER_CLIENT > MAX_PER_USERNAME && MAX_PER_CLIENT <= 50);
});

test('per username: failed logins for one account are cut off with 429, other accounts are not', async (t) => {
  const login = await start(t);
  for (let i = 0; i < MAX_PER_USERNAME; i++) {
    assert.equal((await login('host1', 'wrong-' + i)).status, 401, `attempt ${i + 1}`);
  }
  const blocked = await login('host1', 'wrong-again');
  assert.equal(blocked.status, 429);
  assert.match(blocked.body.error, /Too many login attempts/);

  // Even the right password is refused while the account is limited,
  // and a different case of the same username does not get round it.
  assert.equal((await login('host1', GOOD_PASSWORD)).status, 429);
  assert.equal((await login('HOST1', 'wrong')).status, 429);
  assert.equal((await login('Host1', 'wrong')).status, 429);
  assert.equal(usernameKey('HOST1'), usernameKey('host1'));
  assert.notEqual(usernameKey('host2'), usernameKey('host1'));

  // Another username from the same client is still served.
  assert.equal((await login('someone-else', 'wrong')).status, 401);
});

test('per client: failed logins spread over many usernames are cut off with 429', async (t) => {
  const login = await start(t);
  for (let i = 0; i < MAX_PER_CLIENT; i++) {
    assert.equal((await login('guess-' + i, 'wrong')).status, 401, `attempt ${i + 1}`);
  }
  assert.equal((await login('never-tried-before', 'wrong')).status, 429);
  assert.equal((await login('host1', GOOD_PASSWORD)).status, 429);
});

test('successful logins are not counted against either limit', async (t) => {
  const login = await start(t);
  for (let i = 0; i < MAX_PER_CLIENT + 2; i++) {
    const ok = await login('host1', GOOD_PASSWORD);
    assert.equal(ok.status, 200, `login ${i + 1}`);
    assert.ok(ok.body.token);
  }
  // Failures still count afterwards.
  for (let i = 0; i < MAX_PER_USERNAME; i++) assert.equal((await login('host1', 'wrong')).status, 401);
  assert.equal((await login('host1', 'wrong')).status, 429);
});

test('a username or password that is not a non-empty string gets 400 and never reaches the database', async (t) => {
  const login = await start(t);
  queries = 0;
  const bad = [
    [['host1'], 'wrong'],              // mysql2 would match this array to the host1 row
    [{ username: 'host1' }, 'wrong'],
    [12345, 'wrong'],
    ['', 'wrong'],
    [null, 'wrong'],
    ['host1', ['wrong']],
    ['host1', { length: 5 }],
    ['host1', ''],
  ];
  for (const [username, password] of bad) {
    const r = await login(username, password);
    assert.equal(r.status, 400, JSON.stringify({ username, password }));
  }
  assert.equal(queries, 0);
});

test('an array username cannot be used to keep guessing past the per-username limit', async (t) => {
  const login = await start(t);
  queries = 0;
  // Before the type check each of these was a real guess at host1 that
  // the per-username limit never counted.
  for (let i = 0; i < MAX_PER_USERNAME + 3; i++) {
    assert.equal((await login(['host1'], 'guess-' + i)).status, 400, `attempt ${i + 1}`);
  }
  assert.equal((await login(['host1'], GOOD_PASSWORD)).status, 400); // not even the right password
  assert.equal(queries, 0);
});

test('usernames outside the plain character set get 400 and never reach the database', async (t) => {
  const login = await start(t);

  // host1 is brought to its limit first: none of the spellings below may
  // then be a way to keep guessing at it.
  for (let i = 0; i < MAX_PER_USERNAME; i++) assert.equal((await login('host1', 'wrong-' + i)).status, 401);
  assert.equal((await login('host1', 'wrong')).status, 429);

  queries = 0;
  const spellings = {
    'trailing NUL': 'host1\u0000',
    'zero-width space': 'ho\u200bst1',
    'soft hyphen': 'ho\u00adst1',
    'accented letter': 'h\u00f3st1',
    'combining accent': 'ho\u0301st1',
    'Arabic-Indic digit': 'host\u0661',
    'leading space': ' host1',
    'trailing space': 'host1 ',
  };
  for (const [what, username] of Object.entries(spellings)) {
    const r = await login(username, 'wrong');
    assert.equal(r.status, 400, what);
  }
  assert.equal(queries, 0);
});

test('a username of 50 characters is accepted and 51 is refused', async (t) => {
  const login = await start(t);
  queries = 0;
  assert.equal((await login('a'.repeat(51), 'wrong')).status, 400);
  assert.equal(queries, 0);
  assert.equal((await login('a'.repeat(50), 'wrong')).status, 401); // looked up, not found
  assert.equal(queries, 1);
  assert.equal((await login('A.b_c-9', 'wrong')).status, 401);     // every allowed kind of character
});
