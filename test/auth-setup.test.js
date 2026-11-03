// The first-run setup route must only ever replace the seeded placeholder
// hash, never a real password. The DB pool is stubbed, so no MySQL is needed.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');

const calls = [];
const dbPath = require.resolve(path.join(__dirname, '../server/db'));
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true,
  exports: {
    query: async (sql, params) => {
      calls.push({ sql, params });
      // Pretend only "fresh" still has the placeholder.
      return [{ affectedRows: params[1] === 'fresh' ? 1 : 0 }];
    },
  },
};

const app = express();
app.use(express.json());
app.use('/api/auth', require('../server/routes/auth'));

async function post(server, body) {
  const { port } = server.address();
  const r = await fetch(`http://127.0.0.1:${port}/api/auth/setup`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
}

test('setup only targets rows that still hold the placeholder hash', async (t) => {
  const server = app.listen(0, '127.0.0.1');
  t.after(() => server.close());
  await new Promise((r) => server.once('listening', r));

  const ok = await post(server, { username: 'fresh', password: 'pw-123456' });
  assert.equal(ok.status, 200);
  const last = calls.at(-1);
  assert.match(last.sql, /password_hash LIKE '%placeholder%'/);
  assert.notEqual(last.params[0], 'pw-123456'); // stored hashed, never plain

  const again = await post(server, { username: 'already-set', password: 'x' });
  assert.equal(again.status, 409);

  const missing = await post(server, { username: 'fresh' });
  assert.equal(missing.status, 400);
});
