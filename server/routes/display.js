// ============================================================
// D.A.T.I. — Phase 4: public display snapshot endpoint
//
// Closes the join-mid-event race for /display.html. The /display
// socket namespace only joins a room on display:subscribe; it
// does NOT push current state on connect. So if display.html
// connects (or auto-reconnects) after a question is already
// in flight, it would render blank until the next broadcast.
//
// Same architectural pattern as Phase 2.1's host-side snapshot
// endpoints, except this one is unauthenticated. The display
// screen is meant to be visible to a room of people; nothing on
// it is sensitive (the leaderboard and current question are
// already projected on the wall).
//
// TODO before any real venue deployment:
//   - Rate limiting (public endpoint that hits the DB).
// ============================================================

const express = require('express');
const pool    = require('../db');
const router  = express.Router();

// Map event_state.status enum → current_question.state, or null
// if the event isn't actively on a question right now.
function questionStateFromEnum(s) {
    if (s === 'question_active')   return 'active';
    if (s === 'question_locked')   return 'locked';
    if (s === 'question_revealed') return 'revealed';
    return null;
}

// GET /api/display/:event_id/snapshot
router.get('/:event_id/snapshot', async (req, res) => {
    const eventId = Number(req.params.event_id);
    if (!Number.isInteger(eventId) || eventId <= 0) {
        return res.status(404).json({ error: 'event_not_found' });
    }
    res.set('Cache-Control', 'no-store');

    try {
        const [evRows] = await pool.query(
            'SELECT id, title, theme_id, status, join_code FROM events WHERE id = ?',
            [eventId]
        );
        if (evRows.length === 0) {
            return res.status(404).json({ error: 'event_not_found' });
        }
        const event = evRows[0];

        // Draft event: nothing to render yet beyond the event row itself.
        if (event.status === 'draft') {
            return res.json({
                event,
                current_question: null,
                correct_option:   null,
                scores:           [],
                lifelines_used:   [],
            });
        }

        const [stateRows] = await pool.query(
            `SELECT current_question_id, current_question_index, question_started_at, status
               FROM event_state WHERE event_id = ?`,
            [eventId]
        );
        const state  = stateRows.length > 0 ? stateRows[0] : null;
        const qState = state ? questionStateFromEnum(state.status) : null;

        let current_question = null;
        let correct_option   = null;

        if (state && state.current_question_id && qState) {
            const [qRows] = await pool.query(
                `SELECT q.id, q.question_text,
                        q.option_a, q.option_b, q.option_c, q.option_d,
                        q.difficulty, q.correct_answer,
                        e.time_limit_seconds, e.question_count
                   FROM questions q
                   JOIN events e ON e.id = ?
                  WHERE q.id = ?`,
                [eventId, state.current_question_id]
            );
            if (qRows.length > 0) {
                const q = qRows[0];
                current_question = {
                    question_id:        q.id,
                    question_text:      q.question_text,
                    options:            { A: q.option_a, B: q.option_b, C: q.option_c, D: q.option_d },
                    difficulty:         q.difficulty,
                    time_limit_seconds: q.time_limit_seconds,
                    question_number:    state.current_question_index + 1,
                    total_questions:    q.question_count,
                    started_at:         state.question_started_at ? new Date(state.question_started_at).toISOString() : null,
                    state:              qState,
                };
                if (qState === 'revealed') correct_option = q.correct_answer;
            }
        }

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
        const scores = scoreRows.map(r => ({
            team_id:   r.team_id,
            team_name: r.team_name,
            points:    Number(r.points),
        }));

        const [lifelineRows] = await pool.query(
            `SELECT id AS team_id, team_name FROM teams
              WHERE event_id = ? AND lifeline_used = 1
              ORDER BY id ASC`,
            [eventId]
        );

        res.json({
            event,
            current_question,
            correct_option,
            scores,
            lifelines_used: lifelineRows,
        });
    } catch (err) {
        console.error('display snapshot error:', err);
        res.status(500).json({ error: 'server_error' });
    }
});

module.exports = router;
