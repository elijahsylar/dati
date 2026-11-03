// Pure-function tests. No database or network: requiring the route modules
// only creates the mysql2 pool object, which does not connect until queried.
const test = require('node:test');
const assert = require('node:assert/strict');
const { computePoints } = require('../server/socket');
const events = require('../server/routes/events')._helpers;
const lifeline = require('../server/routes/lifeline')._helpers;

test('speed-based scoring: faster correct answers earn more', () => {
  assert.equal(computePoints(5000, true, 'easy'), 10);
  assert.equal(computePoints(15000, true, 'easy'), 7);
  assert.equal(computePoints(25000, true, 'easy'), 5);
});

test('difficulty multiplies the base (easy 1x, medium 1.5x, hard 2x)', () => {
  assert.equal(computePoints(5000, true, 'medium'), 15);
  assert.equal(computePoints(5000, true, 'hard'), 20);
  assert.equal(computePoints(15000, true, 'medium'), 11); // 7 * 1.5 = 10.5, rounded
});

test('wrong or untimed answers score zero', () => {
  assert.equal(computePoints(1000, false, 'hard'), 0);
  assert.equal(computePoints(null, true, 'hard'), 0);
});

test('boundaries: exactly 10 s and 20 s stay in the faster band', () => {
  assert.equal(computePoints(10000, true, 'easy'), 10);
  assert.equal(computePoints(20000, true, 'easy'), 7);
});

test('join codes are 6 characters from the unambiguous alphabet', () => {
  for (let i = 0; i < 500; i++) {
    const c = events.generateJoinCode();
    assert.match(c, /^[A-Z2-9]{6}$/);
    for (const ch of c) assert.ok(events.JOIN_CODE_ALPHABET.includes(ch));
    assert.ok(!/[IL O01]/.test(c));
  }
});

test('join codes are shown as XXX-XXX', () => {
  assert.equal(events.formatJoinCodeForDisplay('ABC234'), 'ABC-234');
  assert.equal(events.formatJoinCodeForDisplay(null), '');
});

test('HTML escaping covers the five special characters', () => {
  assert.equal(events.htmlEscape(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  assert.equal(lifeline.escHtml(null), '');
});

test('lifeline excerpts keep only search-match spans, escaped', () => {
  const raw = 'the <span class="searchmatch">Eiffel</span> tower <script>x</script>';
  const out = lifeline.renderExcerpt(raw);
  assert.equal(out, 'the <mark class="searchmatch">Eiffel</mark> tower &lt;script&gt;x&lt;/script&gt;');
});

test('lifeline article links stay on mobile Wikipedia', () => {
  assert.equal(lifeline.articleUrl('Eiffel_Tower'), 'https://en.m.wikipedia.org/wiki/Eiffel_Tower');
  assert.ok(lifeline.articleUrl('a b"<').startsWith('https://en.m.wikipedia.org/wiki/'));
  assert.ok(!lifeline.articleUrl('a b"<').includes('"'));
});
