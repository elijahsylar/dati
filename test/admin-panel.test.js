// The admin panel (public/index.html + public/js/admin.js) for a host
// account: a notice with a link to the host page, and no admin-only
// requests. There is no browser here. The real admin.js is run in a node
// vm against a small stand-in for the DOM, localStorage and fetch, so this
// checks the script's decisions (what is shown, what is requested), not
// layout, styling or a real browser's behaviour.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
const script = fs.readFileSync(path.join(__dirname, '../public/js/admin.js'), 'utf8');

const HOST = { id: 2, username: 'host1', display_name: 'Trivia Host', role: 'host' };
const ADMIN = { id: 1, username: 'admin', display_name: 'Venue Admin', role: 'admin' };

// Loads admin.js as the page would, with `stored` as the saved login.
function loadPanel(stored, loginAs) {
    const elements = new Map();
    const element = () => ({
        style: {}, textContent: '', innerHTML: '', className: '', value: 'typed-in',
        classList: { add() {}, remove() {} },
        setAttribute() {}, removeAttribute() {}, addEventListener() {},
    });
    const byId = (id) => {
        if (!elements.has(id)) elements.set(id, element());
        return elements.get(id);
    };
    const store = new Map();
    if (stored) {
        store.set('dati_token', 'stored-token');
        store.set('dati_user', JSON.stringify(stored));
    }
    const requests = [];
    let ready = null;
    const context = {
        console,
        setTimeout: () => 0,
        URL: { revokeObjectURL() {} },
        localStorage: {
            getItem: (k) => (store.has(k) ? store.get(k) : null),
            setItem: (k, v) => store.set(k, String(v)),
            removeItem: (k) => store.delete(k),
        },
        document: {
            getElementById: byId,
            querySelector: () => element(),
            querySelectorAll: () => [],
            addEventListener: (name, fn) => { if (name === 'DOMContentLoaded') ready = fn; },
        },
        fetch: async (url) => {
            requests.push(String(url));
            const body = String(url) === '/api/auth/login' ? { token: 'new-token', user: loginAs } : [];
            return { ok: true, status: 200, json: async () => body };
        },
    };
    vm.createContext(context);
    vm.runInContext(script, context, { filename: 'admin.js' });
    assert.equal(typeof ready, 'function', 'admin.js registers its DOMContentLoaded start-up');
    ready();
    const shown = (id) => byId(id).style.display;
    const settle = () => new Promise((resolve) => setImmediate(resolve));
    return { context, requests, shown, byId, settle };
}

const hostView = (p) => p.shown('host-notice') === 'block' && p.shown('admin-tabs') === 'none' && p.shown('admin-content') === 'none';
const adminView = (p) => p.shown('host-notice') === 'none' && p.shown('admin-tabs') === '' && p.shown('admin-content') === '';

test('the page has the host notice, hidden by default, with a link to the host page', () => {
    const start = html.indexOf('id="host-notice"');
    assert.ok(start > 0, 'index.html has #host-notice');
    const tag = html.slice(html.lastIndexOf('<', start), html.indexOf('>', start));
    assert.match(tag, /style="display:none"/);
    const block = html.slice(start, html.indexOf('id="admin-content"'));
    assert.match(block, /<a href="\/host\.html"[^>]*>Open the host page<\/a>/);
    assert.match(block, /This account runs games from the host page/);
    // The script and the page agree on the three ids.
    for (const id of ['host-notice', 'admin-tabs', 'admin-content']) {
        assert.equal(html.split(`id="${id}"`).length, 2, `one #${id} in index.html`);
        assert.ok(script.includes(`getElementById('${id}')`), `admin.js uses #${id}`);
    }
});

test('a host with a stored login sees the notice and no admin request is sent', async () => {
    const p = loadPanel(HOST);
    await p.settle();
    assert.ok(hostView(p), 'notice shown, tabs and content hidden');
    assert.equal(p.shown('app-screen'), 'block');
    assert.equal(p.byId('user-display').textContent, 'Trivia Host');
    assert.deepEqual(p.requests, []);
});

test('a host who signs in sees the notice; the only request is the login itself', async () => {
    const p = loadPanel(null, HOST);
    assert.equal(p.shown('login-screen'), 'flex');
    await p.context.login({ preventDefault() {} });
    await p.settle();
    assert.ok(hostView(p));
    assert.deepEqual(p.requests, ['/api/auth/login']);
});

test('an admin still gets the tabs and the dashboard requests', async () => {
    const p = loadPanel(ADMIN);
    await p.settle();
    assert.ok(adminView(p), 'notice hidden, tabs and content shown');
    assert.deepEqual([...p.requests].sort(), ['/api/events', '/api/questions', '/api/themes']);
});

test('an admin signing in after a host signed out gets the admin view back', async () => {
    const p = loadPanel(HOST, ADMIN);
    await p.settle();
    assert.ok(hostView(p));
    p.context.logout();
    assert.equal(p.shown('login-screen'), 'flex');
    await p.context.login({ preventDefault() {} });
    await p.settle();
    assert.ok(adminView(p));
    assert.ok(p.requests.includes('/api/questions'));
});
