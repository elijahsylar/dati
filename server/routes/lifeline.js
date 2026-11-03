// ============================================================
// D.A.T.I. — Phase 5 patch: server-side search proxy for the
// lifeline iframe. Backend: Wikipedia REST API.
//
// Why this exists: every general-purpose search engine sets
// `Content-Security-Policy: frame-ancestors 'self'` (or
// `X-Frame-Options: SAMEORIGIN`), blocking iframe embedding from
// any other origin. Our /join.html lifeline overlay therefore
// can't iframe DDG/Brave/Startpage/Searx pages directly.
//
// Workaround: server-side fetch via an actual API, render the
// results from JSON into our own HTML, serve from our own origin.
// The iframe loads OUR URL, no CSP issue. iPad stays inside the
// PWA (Guided Access preserved).
//
// Why Wikipedia specifically:
//   - DDG html scrape: actively bot-blocks server-side requests
//     with a CAPTCHA "anomaly modal" even with proper UA, referer,
//     and cookie bootstrap. Confirmed hostile.
//   - Brave Search API: technically a clean fit, but their free
//     tier requires a credit card on file. Off-limits for a
//     class project budget.
//   - Wikipedia REST API: free, no auth, no anti-bot, no payment.
//     Article links open mobile.wikipedia.org which has no
//     frame-ancestors restriction, so tap-throughs stay inside
//     the iframe (and inside the PWA on iPad). Trivia content
//     coverage is genuinely strong.
//
// TODO before any real venue deployment:
//   - Rate limiting (this route makes outbound API calls on
//     behalf of any caller).
//   - Consider a paid general-search API (Brave, Google CSE) for
//     broader trivia coverage beyond encyclopedia content.
// ============================================================

const express = require('express');
const router  = express.Router();

const WIKI_SEARCH_URL  = 'https://en.wikipedia.org/w/rest.php/v1/search/page';
const WIKI_ARTICLE_URL = 'https://en.m.wikipedia.org/wiki/';
const FETCH_TIMEOUT_MS = 5000;
const MAX_QUERY_LEN    = 200;
const RESULT_LIMIT     = 10;
// Wikipedia asks for descriptive User-Agents that identify the app.
const UA = `DATI-Lifeline/1.0 (${process.env.LIFELINE_CONTACT || 'https://github.com/elijahsylar/dati'})`;

function escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

// Wikipedia's excerpt field contains text with <span class="searchmatch">
// wrapping the matched terms. Allow ONLY those spans through (rewritten as
// <mark>); HTML-escape everything else.
function renderExcerpt(raw) {
    if (!raw) return '';
    const parts = String(raw).split(/(<span class="searchmatch">.*?<\/span>)/g);
    return parts.map(p => {
        const m = p.match(/^<span class="searchmatch">(.*?)<\/span>$/);
        if (m) return `<mark class="searchmatch">${escHtml(m[1])}</mark>`;
        return escHtml(p);
    }).join('');
}

function articleUrl(key) {
    // The key is already in Wikipedia's URL form (spaces as underscores,
    // most special chars pre-encoded). encodeURI preserves the structure
    // while catching anything genuinely unsafe.
    return WIKI_ARTICLE_URL + encodeURI(String(key || ''));
}

function pageShell(innerHtml, title) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(title)}</title>
<style>
*, *::before, *::after { box-sizing: border-box; }
body {
    margin: 0;
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    color: #1A1A1A;
    background: white;
    line-height: 1.45;
    font-size: 16px;
}
.lifeline-bar {
    background: #1E3C6E;
    color: white;
    padding: 10px 14px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    position: sticky;
    top: 0;
    z-index: 10;
}
.lifeline-bar .crumb { font-size: 14px; opacity: 0.95; word-break: break-word; }
.lifeline-bar .crumb b { font-weight: 700; }
.lifeline-bar a {
    background: white;
    color: #1E3C6E;
    padding: 8px 14px;
    font-size: 14px;
    font-weight: 700;
    border-radius: 6px;
    text-decoration: none;
    flex: 0 0 auto;
}
.lifeline-content { padding: 14px; }
.search-form {
    display: flex;
    gap: 8px;
    margin-top: 24px;
}
.search-form input[type="text"] {
    flex: 1;
    padding: 12px 14px;
    font-size: 16px;
    border: 2px solid #E0E0E0;
    border-radius: 8px;
    min-width: 0;
}
.search-form button {
    padding: 12px 20px;
    font-size: 16px;
    font-weight: 700;
    background: #D4A843;
    color: #1E3C6E;
    border: none;
    border-radius: 8px;
    cursor: pointer;
}
.intro {
    margin: 22px 0 8px;
    font-size: 14px;
    color: #6B6B6B;
    text-align: center;
}
.results { list-style: none; margin: 14px 0 0; padding: 0; }
.result { padding: 14px 0; border-bottom: 1px solid #E0E0E0; }
.result:last-child { border-bottom: none; }
.result h3 { margin: 0 0 4px; font-size: 17px; font-weight: 600; line-height: 1.3; }
.result h3 a { color: #1E3C6E; text-decoration: none; }
.result h3 a:hover { text-decoration: underline; }
.result .desc { font-size: 13px; color: #6B6B6B; margin: 0 0 6px; font-style: italic; }
.result .excerpt { font-size: 14px; color: #1A1A1A; margin: 0; }
.result mark.searchmatch {
    background: #FFF3B8;
    color: inherit;
    padding: 0 2px;
    border-radius: 2px;
}
.empty { text-align: center; color: #6B6B6B; padding: 40px 14px; font-size: 14px; }
.attribution {
    margin-top: 24px;
    padding-top: 14px;
    border-top: 1px solid #E0E0E0;
    text-align: center;
    font-size: 12px;
    color: #6B6B6B;
}
a { color: #1E3C6E; }
</style>
</head>
<body>
${innerHtml}
</body>
</html>`;
}

function landingPage() {
    const inner = `
<div class="lifeline-bar">
    <div class="crumb">30-second internet pass. Use it well.</div>
</div>
<div class="lifeline-content">
    <p class="intro">Type your question, then tap Search.</p>
    <form class="search-form" action="/api/lifeline/search" method="GET">
        <input type="text" name="q" placeholder="Search Wikipedia" autofocus required maxlength="200" autocomplete="off">
        <button type="submit">Search</button>
    </form>
</div>`;
    return pageShell(inner, 'Lifeline search');
}

function errorPage(message) {
    const inner = `
<div class="lifeline-bar">
    <div class="crumb">Lifeline search</div>
    <a href="/api/lifeline/search">New search</a>
</div>
<div class="lifeline-content">
    <p class="intro">${escHtml(message)}</p>
</div>`;
    return pageShell(inner, 'Lifeline search');
}

function resultsPage(query, pages) {
    const items = (pages || []).map(p => {
        const desc = p.description ? `<p class="desc">${escHtml(p.description)}</p>` : '';
        const excerpt = p.excerpt ? `<p class="excerpt">${renderExcerpt(p.excerpt)}</p>` : '';
        return `
        <li class="result">
            <h3><a href="${escHtml(articleUrl(p.key))}" target="_blank" rel="noopener noreferrer">${escHtml(p.title)}</a></h3>
            ${desc}
            ${excerpt}
        </li>`;
    }).join('');
    const body = items
        ? `<ul class="results">${items}</ul>`
        : `<p class="empty">No results. Try a different search.</p>`;
    const inner = `
<div class="lifeline-bar">
    <div class="crumb">Searching: <b>${escHtml(query)}</b></div>
    <a href="/api/lifeline/search">New search</a>
</div>
<div class="lifeline-content">
${body}
<p class="attribution">Results from Wikipedia. Tap a title to read the full article.</p>
</div>`;
    return pageShell(inner, 'Lifeline: ' + query);
}

// GET /api/lifeline/search           → landing page
// GET /api/lifeline/search?q=foo     → Wikipedia REST search results for "foo"
router.get('/search', async (req, res) => {
    const raw = req.query.q;
    const q = (raw == null ? '' : String(raw)).trim();

    res.set('Cache-Control', 'no-store');

    if (q.length === 0) {
        return res.type('html').send(landingPage());
    }
    if (q.length > MAX_QUERY_LEN) {
        return res.status(400).type('html').send(errorPage('Search query too long. Try fewer than 200 characters.'));
    }

    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
        const url = `${WIKI_SEARCH_URL}?q=${encodeURIComponent(q)}&limit=${RESULT_LIMIT}`;
        const r = await fetch(url, {
            method:   'GET',
            redirect: 'follow',
            signal:   ctrl.signal,
            headers: {
                'Accept':     'application/json',
                'User-Agent': UA,
            },
        });
        if (r.status === 429) {
            return res.status(502).type('html').send(errorPage(
                'Search rate limit reached. Try again in a moment.'
            ));
        }
        if (!r.ok) {
            return res.status(502).type('html').send(errorPage(
                `Search returned an error (status ${r.status}). Try again.`
            ));
        }
        const data = await r.json();
        const pages = (data && Array.isArray(data.pages)) ? data.pages : [];
        return res.type('html').send(resultsPage(q, pages));
    } catch (err) {
        if (err && err.name === 'AbortError') {
            return res.status(504).type('html').send(errorPage('Search timed out. Try again.'));
        }
        console.error('lifeline search error:', err);
        return res.status(502).type('html').send(errorPage('Could not reach search. Try again.'));
    } finally {
        clearTimeout(timer);
    }
});

module.exports = router;
module.exports._helpers = { escHtml, renderExcerpt, articleUrl };
