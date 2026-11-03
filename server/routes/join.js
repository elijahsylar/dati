// ============================================================
// D.A.T.I. — Public join lookup endpoint
// No JWT auth; this is how /join.html discovers an event by its
// short code. Only returns events in published or live status;
// draft/cancelled/completed events are hidden (404).
// ============================================================

const express = require('express');
const pool = require('../db');
const router = express.Router();

// GET /api/join/:code
// :code can be with or without a dash ("ABC-DEF" or "ABCDEF"),
// any case. Normalizes to 6 canonical uppercase chars before lookup.
router.get('/:code', async (req, res) => {
    try {
        const raw = String(req.params.code || '').replace(/-/g, '').toUpperCase();
        if (!/^[A-Z0-9]{6}$/.test(raw)) {
            return res.status(404).json({ error: 'event_not_available' });
        }
        const [rows] = await pool.query(
            `SELECT e.id, e.title, e.status, e.max_teams, e.max_players_per_team,
                    t.name AS theme_name,
                    (SELECT COUNT(*) FROM teams tm WHERE tm.event_id = e.id) AS current_team_count
               FROM events e
               JOIN themes t ON t.id = e.theme_id
              WHERE e.join_code = ? AND e.status IN ('published', 'live')
              LIMIT 1`,
            [raw]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'event_not_available' });
        const e = rows[0];
        res.json({
            event_id: e.id,
            title: e.title,
            theme_name: e.theme_name,
            status: e.status,
            max_teams: e.max_teams,
            max_players_per_team: e.max_players_per_team,
            current_team_count: Number(e.current_team_count),
        });
    } catch (err) {
        console.error('Join lookup error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
