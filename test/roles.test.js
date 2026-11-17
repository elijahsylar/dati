// Role enforcement on the REST API. admin_users.role is 'admin' or 'host':
// an admin manages content, a host runs a game night. Each row of the
// table below is one route and who may use it. The DB pool is stubbed
// (every query returns no rows), so no MySQL is needed: the tests only
// look at whether a request gets past the role check.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const jwt = require('jsonwebtoken');

// Generated for each run: no secret is written in the tests.
process.env.JWT_SECRET = require('node:crypto').randomBytes(32).toString('hex');

let queries = 0;
const dbPath = require.resolve(path.join(__dirname, '../server/db'));
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true,
  exports: {
    query: async () => {
      queries++;
      const rows = [];
      rows.affectedRows = 0;
      return [rows];
    },
  },
};

const app = express();
app.use(express.json());
app.use('/api/themes', require('../server/routes/themes'));
app.use('/api/questions', require('../server/routes/questions'));
app.use('/api/events', require('../server/routes/events'));

const sign = (claims) => jwt.sign(claims, process.env.JWT_SECRET, { expiresIn: '5m' });
const TOKENS = {
  admin: sign({ id: 1, username: 'admin', role: 'admin' }),
  host: sign({ id: 2, username: 'host1', role: 'host' }),
  // Valid signatures, but not a role the app knows.
  noRole: sign({ id: 3, username: 'legacy' }),
  otherRole: sign({ id: 4, username: 'other', role: 'player' }),
};

// [method, path, who may use it]
const ADMIN = 'admin only';
const HOST = 'admin or host';
const PUBLIC = 'public';
const ROUTES = [
  ['GET',    '/api/themes',                     PUBLIC],
  ['GET',    '/api/themes/1',                   ADMIN],
  ['POST',   '/api/themes',                     ADMIN],
  ['PUT',    '/api/themes/1',                   ADMIN],
  ['DELETE', '/api/themes/1',                   ADMIN],
  ['GET',    '/api/questions',                  ADMIN],
  ['GET',    '/api/questions/1',                ADMIN],
  ['POST',   '/api/questions',                  ADMIN],
  ['PUT',    '/api/questions/1',                ADMIN],
  ['DELETE', '/api/questions/1',                ADMIN],
  ['GET',    '/api/events',                     PUBLIC],
  ['GET',    '/api/events/1',                   PUBLIC],
  ['POST',   '/api/events',                     ADMIN],
  ['PUT',    '/api/events/1',                   ADMIN],
  ['PATCH',  '/api/events/1/status',            ADMIN],
  ['DELETE', '/api/events/1',                   ADMIN],
  ['GET',    '/api/events/1/teams',             HOST],
  ['GET',    '/api/events/1/scores',            HOST],
  ['GET',    '/api/events/1/qr-code.png',       HOST],
  ['GET',    '/api/events/1/print-card.html',   HOST],
];

async function listen(t) {
  const server = app.listen(0, '127.0.0.1');
  t.after(() => server.close());
  await new Promise((r) => server.once('listening', r));
  return `http://127.0.0.1:${server.address().port}`;
}

async function call(base, method, route, token) {
  const headers = { 'content-type': 'application/json', connection: 'close' };
  if (token) headers.authorization = `Bearer ${token}`;
  const init = { method, headers };
  if (method !== 'GET' && method !== 'DELETE') init.body = '{}';
  const before = queries;
  const res = await fetch(base + route, init);
  await res.arrayBuffer();
  return { status: res.status, reachedDb: queries > before };
}

// Past the login and role checks. What the handler then answers (400 for
// the empty body, 404 for the empty database) is not the point here.
const allowed = (status) => status !== 401 && status !== 403;

test('every route in the table is one the app really has', async (t) => {
  const base = await listen(t);
  for (const [method, route] of ROUTES) {
    const r = await call(base, method, route, TOKENS.admin);
    assert.ok(allowed(r.status), `${method} ${route} as admin: ${r.status}`);
  }
});

test('admin-only routes refuse a host with 403 and do not touch the database', async (t) => {
  const base = await listen(t);
  for (const [method, route, who] of ROUTES.filter((r) => r[2] === ADMIN)) {
    const r = await call(base, method, route, TOKENS.host);
    assert.equal(r.status, 403, `${method} ${route} as host (${who})`);
    assert.equal(r.reachedDb, false, `${method} ${route} as host reached the database`);
  }
});

test('host routes let a host and an admin in', async (t) => {
  const base = await listen(t);
  for (const [method, route] of ROUTES.filter((r) => r[2] === HOST)) {
    for (const role of ['host', 'admin']) {
      const r = await call(base, method, route, TOKENS[role]);
      assert.ok(allowed(r.status), `${method} ${route} as ${role}: ${r.status}`);
    }
  }
});

test('a valid token with no role, or an unknown role, is refused on every protected route', async (t) => {
  const base = await listen(t);
  for (const [method, route] of ROUTES.filter((r) => r[2] !== PUBLIC)) {
    for (const name of ['noRole', 'otherRole']) {
      const r = await call(base, method, route, TOKENS[name]);
      assert.equal(r.status, 403, `${method} ${route} with ${name}`);
      assert.equal(r.reachedDb, false);
    }
  }
});

test('protected routes still need a token (401), and public routes need none', async (t) => {
  const base = await listen(t);
  for (const [method, route, who] of ROUTES) {
    const r = await call(base, method, route);
    if (who === PUBLIC) assert.ok(allowed(r.status), `${method} ${route} with no token: ${r.status}`);
    else assert.equal(r.status, 401, `${method} ${route} with no token`);
  }
});

test('no route file has a login check without a role check', () => {
  // Guards the table above against a route added later with auth only.
  const fs = require('node:fs');
  for (const file of ['themes', 'questions', 'events']) {
    const src = fs.readFileSync(path.join(__dirname, `../server/routes/${file}.js`), 'utf8');
    const lines = src.split('\n').filter((l) => /^router\.\w+\(.*\bauth\b/.test(l));
    assert.ok(lines.length > 0, `${file}.js has protected routes`);
    for (const l of lines) assert.match(l, /auth, (adminOnly|hostOrAdmin),/, `${file}.js: ${l.trim()}`);
  }
});
