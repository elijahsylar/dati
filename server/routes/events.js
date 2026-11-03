const express = require('express');
const crypto = require('crypto');
const QRCode = require('qrcode');
const pool = require('../db');
const auth = require('../middleware/auth');
const socketModule = require('../socket');
const router = express.Router();

// 31-char alphabet: A-Z minus I/L/O, 0-9 minus 0/1. Chosen to avoid
// confusables when a human reads a printed code off a QR card.
const JOIN_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generateJoinCode() {
    let out = '';
    for (let i = 0; i < 6; i++) {
        out += JOIN_CODE_ALPHABET[crypto.randomInt(JOIN_CODE_ALPHABET.length)];
    }
    return out;
}

function formatJoinCodeForDisplay(code) {
    return code ? `${code.slice(0, 3)}-${code.slice(3)}` : '';
}

// GET /api/events — list events (optional ?status= filter)
router.get('/', async (req, res) => {
    try {
        let query = `
            SELECT e.*, t.name AS theme_name,
                   (SELECT COUNT(*) FROM questions q WHERE q.theme_id = e.theme_id AND q.is_active = 1) AS available_questions
            FROM events e
            JOIN themes t ON t.id = e.theme_id
        `;
        const params = [];

        if (req.query.status) {
            query += ' WHERE e.status = ?';
            params.push(req.query.status);
        }

        query += ' ORDER BY e.event_date ASC';

        const [rows] = await pool.query(query, params);
        res.json(rows);
    } catch (err) {
        console.error('Get events error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// GET /api/events/:id
router.get('/:id', async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT e.*, t.name AS theme_name
             FROM events e
             JOIN themes t ON t.id = e.theme_id
             WHERE e.id = ?`,
            [req.params.id]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'Event not found' });
        res.json(rows[0]);
    } catch (err) {
        console.error('Get event error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /api/events — create event
router.post('/', auth, async (req, res) => {
    try {
        const { theme_id, title, event_date, start_time, max_teams, max_players_per_team, question_count, time_limit_seconds } = req.body;

        if (!theme_id || !title || !event_date) {
            return res.status(400).json({ error: 'theme_id, title, and event_date are required' });
        }

        const [result] = await pool.query(
            `INSERT INTO events (theme_id, title, event_date, start_time, max_teams, max_players_per_team, question_count, time_limit_seconds)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                theme_id, title, event_date,
                start_time || '19:00:00',
                max_teams || 30,
                max_players_per_team || 5,
                question_count || 10,
                time_limit_seconds || 30
            ]
        );

        const [event] = await pool.query('SELECT * FROM events WHERE id = ?', [result.insertId]);
        res.status(201).json(event[0]);
    } catch (err) {
        console.error('Create event error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// PUT /api/events/:id — update event (non-status fields only).
// Status transitions go through PATCH /api/events/:id/status so validation
// is centralized (live/completed are socket-layer owned).
router.put('/:id', auth, async (req, res) => {
    try {
        const allowed = ['theme_id', 'title', 'event_date', 'start_time', 'max_teams', 'max_players_per_team', 'question_count', 'time_limit_seconds'];
        const fields = [];
        const values = [];

        for (const key of allowed) {
            if (req.body[key] !== undefined) {
                fields.push(`${key} = ?`);
                values.push(req.body[key]);
            }
        }

        if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });

        values.push(req.params.id);
        await pool.query(`UPDATE events SET ${fields.join(', ')} WHERE id = ?`, values);

        const [event] = await pool.query('SELECT * FROM events WHERE id = ?', [req.params.id]);
        res.json(event[0]);
    } catch (err) {
        console.error('Update event error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// PATCH /api/events/:id/status — admin lifecycle transitions.
// Allowed target states: draft | published | cancelled.
// live and completed are set by the socket layer (host:start_event /
// game:ended) and are never admin-settable. A currently-live event also
// cannot be changed from admin at all — that's socket-layer territory.
//
// Join-code side effects (Phase 2):
//   * target = published AND current != published → generate a fresh
//     6-char code, retry up to 5 times on UNIQUE collision.
//   * target = draft → clear join_code to NULL (any source state).
//   * target = cancelled → leave code alone (historical reference).
//   * Re-publishing a published event (idempotent) is a no-op on code.
router.patch('/:id/status', auth, async (req, res) => {
    try {
        const { status } = req.body || {};
        const allowedTargets = ['draft', 'published', 'cancelled'];
        if (!allowedTargets.includes(status)) {
            return res.status(400).json({
                error: 'invalid_status',
                message: `status must be one of: ${allowedTargets.join(', ')}`,
            });
        }
        const [rows] = await pool.query('SELECT status FROM events WHERE id = ?', [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Event not found' });
        const currentStatus = rows[0].status;
        if (currentStatus === 'live') {
            return res.status(409).json({
                error: 'conflict',
                message: 'Live events cannot be changed from admin. Use the host console.',
            });
        }

        const goingToPublished = status === 'published' && currentStatus !== 'published';
        const goingToDraft = status === 'draft';

        if (goingToPublished) {
            let assigned = false;
            for (let attempt = 0; attempt < 5 && !assigned; attempt++) {
                const code = generateJoinCode();
                try {
                    await pool.query(
                        'UPDATE events SET status = ?, join_code = ? WHERE id = ?',
                        [status, code, req.params.id]
                    );
                    assigned = true;
                } catch (err) {
                    if (err.code === 'ER_DUP_ENTRY') continue;
                    throw err;
                }
            }
            if (!assigned) {
                return res.status(500).json({
                    error: 'code_generation_failed',
                    message: 'Could not generate a unique join code after 5 attempts',
                });
            }
        } else if (goingToDraft) {
            // Reset to Draft: wipe per-run state so a re-publish starts
            // clean. Without this, old teams + answers + event_state
            // rows from the previous run would survive into the next
            // run and pollute roster + leaderboard.
            const conn = await pool.getConnection();
            try {
                await conn.beginTransaction();
                await conn.query(
                    'DELETE FROM team_answers WHERE team_id IN (SELECT id FROM teams WHERE event_id = ?)',
                    [req.params.id]
                );
                await conn.query('DELETE FROM teams WHERE event_id = ?', [req.params.id]);
                await conn.query('DELETE FROM event_state WHERE event_id = ?', [req.params.id]);
                await conn.query(
                    'UPDATE events SET status = ?, join_code = NULL WHERE id = ?',
                    [status, req.params.id]
                );
                await conn.commit();
            } catch (txErr) {
                try { await conn.rollback(); } catch (_) {}
                conn.release();
                console.error('Reset to Draft cleanup failed:', txErr);
                return res.status(500).json({ error: 'Server error' });
            }
            conn.release();
            // Re-broadcast empty leaderboard so any connected /host or
            // /display sockets re-render the empty state immediately.
            if (socketModule.broadcast) {
                socketModule.broadcast(Number(req.params.id), 'scores:update', { scores: [] });
            }
        } else {
            await pool.query('UPDATE events SET status = ? WHERE id = ?', [status, req.params.id]);
        }

        const [updated] = await pool.query('SELECT * FROM events WHERE id = ?', [req.params.id]);
        res.json(updated[0]);
    } catch (err) {
        console.error('Patch event status error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

function htmlEscape(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g,
        c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// GET /api/events/:id/print-card.html — printable 4-up tent-card sheet.
// Admin JWT required. Auto-triggers window.print() on load so the host
// just confirms the system print dialog. Layout fits 2x2 on standard
// 8.5x11 with cut/fold guide borders.
router.get('/:id/print-card.html', auth, async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT e.id, e.title, e.join_code, t.name AS theme_name
               FROM events e JOIN themes t ON t.id = e.theme_id
              WHERE e.id = ?`,
            [req.params.id]
        );
        if (rows.length === 0 || !rows[0].join_code) {
            return res.status(404).send('No join code for this event');
        }
        const e = rows[0];
        const displayCode = formatJoinCodeForDisplay(e.join_code);
        const url = `${req.protocol}://${req.get('host')}/join.html?code=${encodeURIComponent(displayCode)}`;
        const qrDataUrl = await QRCode.toDataURL(url, {
            errorCorrectionLevel: 'H',
            width: 300,
            margin: 2,
            color: { dark: '#000000', light: '#FFFFFF' },
        });
        const title = htmlEscape(e.title);
        const card = `
            <div class="card">
                <div class="brand">D.A.T.I<span>.</span></div>
                <div class="event-title">${title}</div>
                <img class="qr" src="${qrDataUrl}" alt="Join QR code">
                <div class="scan-label">SCAN TO JOIN</div>
                <div class="code">${htmlEscape(displayCode)}</div>
                <div class="instructions">Or visit <b>${htmlEscape(req.get('host'))}/join.html</b><br>and enter the code</div>
                <div class="footer">${htmlEscape(process.env.VENUE_NAME || 'TRIVIA NIGHT')}</div>
            </div>`;
        const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>D.A.T.I. — ${title} — Print Cards</title>
<style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 0; font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; color: #000; background: #FFF; }
    .sheet {
        width: 8.5in; height: 11in;
        display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr;
        gap: 0; margin: 0 auto;
    }
    .card {
        padding: 0.35in;
        border: 1px dashed #CCC;
        display: flex; flex-direction: column;
        justify-content: center; align-items: center; text-align: center;
        page-break-inside: avoid;
    }
    .brand { font-size: 14pt; font-weight: 700; letter-spacing: 3pt; margin-bottom: 4pt; }
    .brand span { font-weight: 900; }
    .event-title { font-size: 13pt; font-weight: 600; margin: 0 0 12pt; color: #333; max-width: 3in; }
    .qr { width: 1.8in; height: 1.8in; }
    .scan-label { font-size: 9pt; letter-spacing: 2pt; color: #555; margin: 8pt 0 2pt; }
    .code {
        font-size: 42pt; font-weight: 800;
        font-family: 'SF Mono', Menlo, Consolas, monospace;
        letter-spacing: 4pt; margin: 0 0 8pt; color: #000;
    }
    .instructions { font-size: 9pt; line-height: 1.4; color: #555; margin-top: 4pt; max-width: 3in; }
    .instructions b { color: #000; }
    .footer { margin-top: 12pt; font-size: 7pt; color: #999; letter-spacing: 2pt; }
    @media screen {
        body { background: #EEE; padding: 20px; }
        .sheet { background: #FFF; box-shadow: 0 4px 20px rgba(0,0,0,0.15); }
        .print-hint {
            position: fixed; top: 10px; left: 50%; transform: translateX(-50%);
            background: #333; color: #FFF; padding: 8px 14px; border-radius: 6px;
            font-size: 12px; font-family: -apple-system, sans-serif;
        }
    }
    @media print {
        body { background: #FFF; padding: 0; }
        .sheet { box-shadow: none; }
        .card { border: 1px dashed #999; }
        .print-hint { display: none; }
        @page { size: letter portrait; margin: 0; }
    }
</style>
</head>
<body>
<div class="print-hint">Use your browser's Print dialog — already opening…</div>
<div class="sheet">${card}${card}${card}${card}</div>
<script>window.addEventListener('load', () => setTimeout(() => window.print(), 250));</script>
</body>
</html>`;
        res.set('Content-Type', 'text/html; charset=utf-8');
        res.set('Cache-Control', 'no-store');
        res.send(html);
    } catch (err) {
        console.error('Print card error:', err);
        res.status(500).send('Server error');
    }
});

// GET /api/events/:id/teams — admin snapshot of teams registered to an event.
// Exists so /host.html can populate its roster on load/reload instead of
// relying only on live lobby:team_joined broadcasts. Closes the race where
// a host connects after players have already joined and never sees them.
// Ordered by joined_at ASC so first-join-first-displayed.
router.get('/:id/teams', auth, async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT id AS team_id, team_name, member_count, lifeline_used, joined_at
               FROM teams
              WHERE event_id = ?
              ORDER BY joined_at ASC, id ASC`,
            [req.params.id]
        );
        res.json(rows.map(r => ({
            team_id: r.team_id,
            team_name: r.team_name,
            member_count: r.member_count,
            lifeline_used: !!r.lifeline_used,
            joined_at: r.joined_at,
        })));
    } catch (err) {
        console.error('Get teams error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// GET /api/events/:id/scores — admin snapshot of cumulative scores.
// Payload shape matches the scores:update socket broadcast exactly so
// /host.html can reuse its existing render function. last_answer_correct
// reflects the current/most-recent question on event_state; null means
// "no question yet" or "this team didn't submit for the current question".
router.get('/:id/scores', auth, async (req, res) => {
    try {
        const eventId = req.params.id;
        const [evRows] = await pool.query('SELECT id FROM events WHERE id = ?', [eventId]);
        if (evRows.length === 0) return res.status(404).json({ error: 'Event not found' });

        const [scoreRows] = await pool.query(
            `SELECT t.id AS team_id, t.team_name,
                    COALESCE(SUM(ta.points_earned), 0) AS points
               FROM teams t
               LEFT JOIN team_answers ta ON ta.team_id = t.id
              WHERE t.event_id = ?
              GROUP BY t.id, t.team_name
              ORDER BY points DESC, t.id ASC`,
            [eventId]
        );

        const [stateRows] = await pool.query(
            'SELECT current_question_id FROM event_state WHERE event_id = ?',
            [eventId]
        );
        const currentQid = stateRows.length > 0 ? stateRows[0].current_question_id : null;

        let correctMap = new Map();
        if (currentQid) {
            const [answers] = await pool.query(
                `SELECT ta.team_id, (ta.points_earned > 0) AS correct
                   FROM team_answers ta
                   JOIN teams t ON t.id = ta.team_id
                  WHERE ta.question_id = ? AND t.event_id = ?`,
                [currentQid, eventId]
            );
            correctMap = new Map(answers.map(r => [r.team_id, !!r.correct]));
        }

        res.json(scoreRows.map(r => ({
            team_id: r.team_id,
            team_name: r.team_name,
            points: Number(r.points),
            last_answer_correct: correctMap.has(r.team_id) ? correctMap.get(r.team_id) : null,
        })));
    } catch (err) {
        console.error('Get scores error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// GET /api/events/:id/qr-code.png — PNG QR code for the event's join URL.
// JWT-auth (admin). Returns 404 if the event has no join_code (draft/cancelled
// without a prior publish). 400x400, high error correction, no-cache so hosts
// always get the current code after republish.
router.get('/:id/qr-code.png', auth, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT join_code FROM events WHERE id = ?', [req.params.id]);
        if (rows.length === 0 || !rows[0].join_code) {
            return res.status(404).json({ error: 'no_join_code' });
        }
        const displayCode = formatJoinCodeForDisplay(rows[0].join_code);
        const url = `${req.protocol}://${req.get('host')}/join.html?code=${encodeURIComponent(displayCode)}`;
        const buf = await QRCode.toBuffer(url, {
            errorCorrectionLevel: 'H',
            type: 'png',
            width: 400,
            margin: 2,
            color: { dark: '#000000', light: '#FFFFFF' },
        });
        res.set('Content-Type', 'image/png');
        res.set('Cache-Control', 'no-store');
        res.send(buf);
    } catch (err) {
        console.error('QR code error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// DELETE /api/events/:id — legacy cancel route. Kept for any external
// callers; the admin UI now uses PATCH /status with status='cancelled'
// so it flows through the same validation gate.
router.delete('/:id', auth, async (req, res) => {
    try {
        await pool.query("UPDATE events SET status = 'cancelled' WHERE id = ?", [req.params.id]);
        res.json({ message: 'Event cancelled' });
    } catch (err) {
        console.error('Delete event error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
module.exports._helpers = { generateJoinCode, formatJoinCodeForDisplay, htmlEscape, JOIN_CODE_ALPHABET };
