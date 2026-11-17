// The first-run setup route must only ever replace the seeded placeholder
// hash, never a real password, and must not work without the setup secret
// from the environment. The DB pool is stubbed, so no MySQL is needed.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');

// Generated for each run: no secret is written in the tests.
const SECRET = require('node:crypto').randomBytes(24).toString('hex');
const calls = [];
let placeholdersLeft = 2;
const dbPath = require.resolve(path.join(__dirname, '../server/db'));
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true,
  exports: {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (/^SELECT COUNT\(\*\) AS n FROM admin_users/.test(sql)) return [[{ n: placeholdersLeft }]];
      // Pretend only "fresh" still has the placeholder.
      return [{ affectedRows: params[1] === 'fresh' ? 1 : 0 }];
    },
  },
};

const app = express();
app.use(express.json());
app.use('/api/auth', require('../server/routes/auth'));

async function post(server, body, secret) {
  const { port } = server.address();
  // No keep-alive: an idle kept-alive connection would hold the server open in teardown.
  const headers = { 'content-type': 'application/json', connection: 'close' };
  if (secret !== undefined) headers['x-setup-secret'] = secret;
  const r = await fetch(`http://127.0.0.1:${port}/api/auth/setup`, {
    method: 'POST', headers, body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
}

async function listen(t) {
  const server = app.listen(0, '127.0.0.1');
  t.after(() => server.close());
  await new Promise((r) => server.once('listening', r));
  return server;
}

test.beforeEach(() => {
  process.env.SETUP_SECRET = SECRET;
  placeholdersLeft = 2;
  calls.length = 0;
});

test('setup only targets rows that still hold the placeholder hash', async (t) => {
  const server = await listen(t);

  const ok = await post(server, { username: 'fresh', password: 'pw-123456' }, SECRET);
  assert.equal(ok.status, 200);
  const last = calls.at(-1);
  assert.match(last.sql, /password_hash LIKE '%placeholder%'/);
  assert.notEqual(last.params[0], 'pw-123456'); // stored hashed, never plain

  const again = await post(server, { username: 'already-set', password: 'x' }, SECRET);
  assert.equal(again.status, 409);

  const missing = await post(server, { username: 'fresh' }, SECRET);
  assert.equal(missing.status, 400);
});

test('setup is refused without the setup secret, and never reaches the database', async (t) => {
  const server = await listen(t);

  const none = await post(server, { username: 'fresh', password: 'pw-123456' });
  assert.equal(none.status, 403);

  const wrong = await post(server, { username: 'fresh', password: 'pw-123456' }, 'not-the-secret');
  assert.equal(wrong.status, 403);

  // A prefix of the right secret, and the right secret plus one character.
  const prefix = await post(server, { username: 'fresh', password: 'pw-123456' }, SECRET.slice(0, -1));
  assert.equal(prefix.status, 403);
  const longer = await post(server, { username: 'fresh', password: 'pw-123456' }, SECRET + 'x');
  assert.equal(longer.status, 403);

  assert.equal(calls.length, 0);
});

test('setup is off when SETUP_SECRET is unset or empty (no open fallback)', async (t) => {
  const server = await listen(t);

  delete process.env.SETUP_SECRET;
  const unset = await post(server, { username: 'fresh', password: 'pw-123456' });
  assert.equal(unset.status, 404);
  const unsetWithHeader = await post(server, { username: 'fresh', password: 'pw-123456' }, 'anything');
  assert.equal(unsetWithHeader.status, 404);

  process.env.SETUP_SECRET = '';
  const empty = await post(server, { username: 'fresh', password: 'pw-123456' }, '');
  assert.equal(empty.status, 404);

  assert.equal(calls.length, 0);
});

test('setup stays off when SETUP_SECRET is shorter than 16 characters', async (t) => {
  const server = await listen(t);

  const short = 'x'.repeat(15);
  process.env.SETUP_SECRET = short;
  const off = await post(server, { username: 'fresh', password: 'pw-123456' }, short);
  assert.equal(off.status, 404);
  assert.equal(calls.length, 0);

  // 16 characters is enough.
  const enough = 'x'.repeat(16);
  process.env.SETUP_SECRET = enough;
  const on = await post(server, { username: 'fresh', password: 'pw-123456' }, enough);
  assert.equal(on.status, 200);
});

test('setup refuses a username or password that is not a non-empty string, before any query', async (t) => {
  const server = await listen(t);

  const bad = [
    { username: ['fresh'], password: 'pw-123456' },
    { username: { username: 'fresh' }, password: 'pw-123456' },
    { username: 'fresh', password: ['pw-123456'] },
    { username: 'fresh', password: 12345678 },
    { username: '', password: 'pw-123456' },
    { username: null, password: 'pw-123456' },
  ];
  for (const body of bad) {
    const r = await post(server, body, SECRET);
    assert.equal(r.status, 400, JSON.stringify(body));
  }
  assert.equal(calls.length, 0);
});

test('setup answers 404 once no placeholder account remains', async (t) => {
  const server = await listen(t);
  placeholdersLeft = 0;

  const done = await post(server, { username: 'fresh', password: 'pw-123456' }, SECRET);
  assert.equal(done.status, 404);
  assert.ok(!calls.some((c) => /^UPDATE/.test(c.sql)));
});
