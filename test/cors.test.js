// CORS is limited to the origins in CORS_ORIGIN, on the REST API and on
// Socket.io. This loads the real app (server/index.js) with an in-memory
// fake of the database pool; the app does not listen until the test asks.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { installFakeDb } = require('./fake-db');

const ALLOWED = 'https://trivia.example.com';
const ALSO_ALLOWED = 'https://admin.example.com';
const REFUSED = 'https://evil.example.net';

// Generated for each run: no secret is written in the tests.
process.env.JWT_SECRET = require('node:crypto').randomBytes(32).toString('hex');
process.env.CORS_ORIGIN = `${ALLOWED}, ${ALSO_ALLOWED}/`;
installFakeDb();
const { allowedOrigins } = require('../server/cors');
const { server, io } = require('../server/index');

console.log = () => {};

// node:http rather than fetch, so the Origin header is sent exactly as given.
function request(method, path, headers = {}) {
    return new Promise((resolve, reject) => {
        const req = http.request(
            { host: '127.0.0.1', port: server.address().port, method, path, headers: { connection: 'close', ...headers } },
            (res) => { res.resume(); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers })); }
        );
        req.on('error', reject);
        req.end();
    });
}

test.before(() => new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)));
test.after(() => new Promise((resolve) => io.close(resolve)));

test('the origin list: localhost by default, exact entries, never a wildcard', () => {
    const silenced = console.warn;
    console.warn = () => {};
    try {
        assert.deepEqual(allowedOrigins({}), ['http://localhost:3000']);
        assert.deepEqual(allowedOrigins({ PORT: '8080', CORS_ORIGIN: '  ' }), ['http://localhost:8080']);
        assert.deepEqual(
            allowedOrigins({ CORS_ORIGIN: 'https://a.example.com/, https://b.example.com' }),
            ['https://a.example.com', 'https://b.example.com']
        );
        // "*" is not passed through, alone or in a list.
        assert.deepEqual(allowedOrigins({ CORS_ORIGIN: '*' }), ['http://localhost:3000']);
        assert.deepEqual(allowedOrigins({ CORS_ORIGIN: '*, https://a.example.com, https://*.example.com, null' }), ['https://a.example.com']);
    } finally {
        console.warn = silenced;
    }
});

test('REST: a configured origin is allowed', async () => {
    for (const origin of [ALLOWED, ALSO_ALLOWED]) {
        const res = await request('GET', '/api/display/999/snapshot', { origin });
        assert.equal(res.status, 404); // the request reached the route
        assert.equal(res.headers['access-control-allow-origin'], origin);
    }
});

test('REST: an origin outside the list is refused (no allow-origin header, no wildcard)', async () => {
    const res = await request('GET', '/api/display/999/snapshot', { origin: REFUSED });
    assert.equal(res.headers['access-control-allow-origin'], undefined);

    const preflight = await request('OPTIONS', '/api/auth/login', {
        origin: REFUSED,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
    });
    assert.equal(preflight.headers['access-control-allow-origin'], undefined);

    const allowedPreflight = await request('OPTIONS', '/api/auth/login', {
        origin: ALLOWED,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
    });
    assert.equal(allowedPreflight.headers['access-control-allow-origin'], ALLOWED);

    // The default localhost origin is not allowed once a list is configured.
    const local = await request('GET', '/api/display/999/snapshot', { origin: 'http://localhost:3000' });
    assert.equal(local.headers['access-control-allow-origin'], undefined);
});

test('Socket.io: the polling handshake sends CORS headers only to a configured origin', async () => {
    const path = '/socket.io/?EIO=4&transport=polling';
    const ok = await request('GET', path, { origin: ALLOWED });
    assert.equal(ok.status, 200);
    assert.equal(ok.headers['access-control-allow-origin'], ALLOWED);

    const refused = await request('GET', path, { origin: REFUSED });
    assert.equal(refused.headers['access-control-allow-origin'], undefined);
});
