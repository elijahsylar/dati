// An in-memory stand-in for server/db.js (the mysql2 pool), so the socket
// server and the routes can be tested without MySQL. It answers the SQL
// that server/socket.js and server/routes/display.js send, matched by the
// start of each statement, and throws on anything it does not know: new
// SQL in the server then fails a test loudly instead of passing by accident.
//
// Not modelled: rollback (the server only rolls back before it has written
// anything), row locks, and foreign keys.
const path = require('node:path');

function dup() {
    const e = new Error('Duplicate entry');
    e.code = 'ER_DUP_ENTRY';
    return e;
}

function createFakeDb() {
    const s = {
        events: [],        // { id, title, theme_id, status, join_code, question_count, time_limit_seconds }
        questions: [],     // { id, theme_id, is_active, question_text, option_a..d, correct_answer, difficulty }
        eventState: [],    // { event_id, current_question_index, current_question_id, question_started_at, status }
        teams: [],         // { id, event_id, team_name, session_token, member_count, lifeline_used }
        teamAnswers: [],   // { team_id, question_id, selected_option, response_time_ms, points_earned }
        adminUsers: [],    // { id, username, password_hash, display_name, role, is_active }
        nextTeamId: 1,
        openConnections: 0,
        failNext: null,    // set to an Error to make the next query throw it
        onQuery: null,     // async (sql) => {} run before each query; lets a test hold one back
    };

    const stateOf = (eventId) => s.eventState.find(r => r.event_id === Number(eventId));
    const eventOf = (id) => s.events.find(r => r.id === Number(id));
    const questionOf = (id) => s.questions.find(r => r.id === Number(id));

    function scores(eventId) {
        return s.teams
            .filter(t => t.event_id === Number(eventId))
            .map(t => ({
                team_id: t.id,
                team_name: t.team_name,
                points: s.teamAnswers.filter(a => a.team_id === t.id).reduce((n, a) => n + a.points_earned, 0),
            }))
            .sort((a, b) => b.points - a.points || a.team_id - b.team_id);
    }

    function questionWithEvent(eventId, questionId) {
        const q = questionOf(questionId);
        const e = eventOf(eventId);
        if (!q || !e) return [];
        return [{ ...q, time_limit_seconds: e.time_limit_seconds, question_count: e.question_count }];
    }

    // [start of the statement, handler(params)]. The first match wins.
    const handlers = [
        // ---- scores -------------------------------------------------
        ['SELECT t.id AS team_id, t.team_name, COALESCE(SUM(ta.points_earned), 0) AS points',
            ([eventId]) => scores(eventId)],
        ['SELECT ta.team_id, (ta.points_earned > 0) AS correct',
            ([questionId, eventId]) => s.teamAnswers
                .filter(a => a.question_id === questionId
                    && s.teams.some(t => t.id === a.team_id && t.event_id === Number(eventId)))
                .map(a => ({ team_id: a.team_id, correct: a.points_earned > 0 ? 1 : 0 }))],

        // ---- event_state --------------------------------------------
        ['SELECT current_question_index FROM event_state WHERE event_id = ?',
            ([eventId]) => s.eventState.filter(r => r.event_id === eventId)],
        ['SELECT status, current_question_id, question_started_at, current_question_index FROM event_state',
            ([eventId]) => s.eventState.filter(r => r.event_id === eventId)],
        ['SELECT status, current_question_id, question_started_at FROM event_state',
            ([eventId]) => s.eventState.filter(r => r.event_id === eventId)],
        ['SELECT status, current_question_id FROM event_state',
            ([eventId]) => s.eventState.filter(r => r.event_id === eventId)],
        ['SELECT status FROM event_state WHERE event_id = ?',
            ([eventId]) => s.eventState.filter(r => r.event_id === eventId)],
        ['SELECT current_question_id, current_question_index, question_started_at, status FROM event_state',
            ([eventId]) => s.eventState.filter(r => r.event_id === eventId)],
        ['INSERT INTO event_state (event_id, current_question_index, status)',
            ([eventId]) => {
                const row = stateOf(eventId);
                const fresh = { event_id: eventId, current_question_index: -1, current_question_id: null, question_started_at: null, status: 'lobby' };
                if (row) Object.assign(row, fresh); else s.eventState.push(fresh);
                return { affectedRows: 1 };
            }],
        ['UPDATE event_state SET current_question_index = ?, current_question_id = ?, question_started_at = CURRENT_TIMESTAMP(3), status = \'question_active\'',
            ([index, questionId, eventId]) => {
                Object.assign(stateOf(eventId), {
                    current_question_index: index, current_question_id: questionId,
                    question_started_at: new Date(), status: 'question_active',
                });
                return { affectedRows: 1 };
            }],
        ['UPDATE event_state SET status = \'question_revealed\' WHERE event_id = ? AND status = \'question_locked\'',
            ([eventId]) => {
                const row = stateOf(eventId);
                if (!row || row.status !== 'question_locked') return { affectedRows: 0 };
                row.status = 'question_revealed';
                return { affectedRows: 1 };
            }],
        ['UPDATE event_state SET status = \'ended\' WHERE event_id = ?',
            ([eventId]) => {
                const row = stateOf(eventId);
                if (row) row.status = 'ended';
                return { affectedRows: row ? 1 : 0 };
            }],
        ['UPDATE event_state SET status = ? WHERE event_id = ?',
            ([status, eventId]) => {
                const row = stateOf(eventId);
                if (row) row.status = status;
                return { affectedRows: row ? 1 : 0 };
            }],

        // ---- events -------------------------------------------------
        ['SELECT theme_id, question_count, time_limit_seconds FROM events WHERE id = ?',
            ([id]) => s.events.filter(e => e.id === id)],
        ['SELECT id, title, theme_id, status, join_code FROM events WHERE id = ?',
            ([id]) => s.events.filter(e => e.id === id).map(({ id: eid, title, theme_id, status, join_code }) => ({ id: eid, title, theme_id, status, join_code }))],
        ['SELECT id, status FROM events WHERE id = ?',
            ([id]) => s.events.filter(e => e.id === id).map(e => ({ id: e.id, status: e.status }))],
        ['SELECT id FROM events WHERE id = ?',
            ([id]) => s.events.filter(e => e.id === Number(id)).map(e => ({ id: e.id }))],
        ['UPDATE events SET status = \'live\' WHERE id = ? AND status = \'published\'',
            ([id]) => {
                const e = eventOf(id);
                if (!e || e.status !== 'published') return { affectedRows: 0 };
                e.status = 'live';
                return { affectedRows: 1 };
            }],
        ['UPDATE events SET status = \'completed\' WHERE id = ? AND status = \'live\'',
            ([id]) => {
                const e = eventOf(id);
                if (!e || e.status !== 'live') return { affectedRows: 0 };
                e.status = 'completed';
                return { affectedRows: 1 };
            }],

        // ---- questions ----------------------------------------------
        ['SELECT id, question_text, option_a, option_b, option_c, option_d, difficulty FROM questions WHERE theme_id = ? AND is_active = 1 ORDER BY id LIMIT 1 OFFSET ?',
            ([themeId, offset]) => s.questions
                .filter(q => q.theme_id === themeId && q.is_active)
                .sort((a, b) => a.id - b.id)
                .slice(offset, offset + 1)
                // Only the selected columns: the answer must not ride along.
                .map(({ id, question_text, option_a, option_b, option_c, option_d, difficulty }) =>
                    ({ id, question_text, option_a, option_b, option_c, option_d, difficulty }))],
        ['SELECT id, correct_answer, difficulty FROM questions WHERE id = ?',
            ([id]) => s.questions.filter(q => q.id === id).map(q => ({ id: q.id, correct_answer: q.correct_answer, difficulty: q.difficulty }))],
        ['SELECT id, correct_answer FROM questions WHERE id = ?',
            ([id]) => s.questions.filter(q => q.id === id).map(q => ({ id: q.id, correct_answer: q.correct_answer }))],
        ['SELECT q.id, q.question_text, q.option_a, q.option_b, q.option_c, q.option_d, q.difficulty, q.correct_answer, e.time_limit_seconds, e.question_count',
            ([eventId, questionId]) => questionWithEvent(eventId, questionId)],
        ['SELECT q.id, q.question_text, q.option_a, q.option_b, q.option_c, q.option_d, q.difficulty, e.time_limit_seconds',
            ([eventId, questionId]) => questionWithEvent(eventId, questionId).map(({ correct_answer, ...rest }) => rest)],

        // ---- admin users (login) ------------------------------------
        ['SELECT * FROM admin_users WHERE username = ? AND is_active = 1',
            ([username]) => s.adminUsers.filter(u => u.is_active
                && u.username.toLowerCase() === String(username).toLowerCase())],

        // ---- teams and answers --------------------------------------
        ['SELECT id, event_id, team_name FROM teams WHERE session_token = ?',
            ([token]) => s.teams.filter(t => t.session_token === token).slice(0, 1)
                .map(t => ({ id: t.id, event_id: t.event_id, team_name: t.team_name }))],
        ['INSERT INTO teams (event_id, team_name, session_token, member_count)',
            ([eventId, teamName, sessionToken, memberCount]) => {
                if (s.teams.some(t => t.event_id === eventId && t.team_name === teamName)) throw dup();
                const id = s.nextTeamId++;
                s.teams.push({ id, event_id: eventId, team_name: teamName, session_token: sessionToken, member_count: memberCount, lifeline_used: 0 });
                return { insertId: id, affectedRows: 1 };
            }],
        ['SELECT COUNT(*) AS n FROM teams WHERE event_id = ?',
            ([eventId]) => [{ n: s.teams.filter(t => t.event_id === eventId).length }]],
        ['INSERT INTO team_answers (team_id, question_id, selected_option, response_time_ms, points_earned)',
            ([teamId, questionId, selectedOption, responseTimeMs, points]) => {
                if (s.teamAnswers.some(a => a.team_id === teamId && a.question_id === questionId)) throw dup();
                s.teamAnswers.push({ team_id: teamId, question_id: questionId, selected_option: selectedOption, response_time_ms: responseTimeMs, points_earned: points });
                return { affectedRows: 1 };
            }],
        ['SELECT COUNT(*) AS answered, (SELECT COUNT(*) FROM teams WHERE event_id = ?) AS total',
            ([eventId, , questionId]) => {
                const teamIds = s.teams.filter(t => t.event_id === eventId).map(t => t.id);
                return [{
                    answered: s.teamAnswers.filter(a => a.question_id === questionId && teamIds.includes(a.team_id)).length,
                    total: teamIds.length,
                }];
            }],
        ['UPDATE teams SET lifeline_used = 1 WHERE id = ? AND lifeline_used = 0',
            ([id]) => {
                const t = s.teams.find(r => r.id === id && !r.lifeline_used);
                if (t) t.lifeline_used = 1;
                return { affectedRows: t ? 1 : 0 };
            }],
        ['SELECT id AS team_id, team_name FROM teams WHERE event_id = ? AND lifeline_used = 1',
            ([eventId]) => s.teams.filter(t => t.event_id === eventId && t.lifeline_used)
                .map(t => ({ team_id: t.id, team_name: t.team_name }))],
        ['SELECT id FROM teams WHERE id = ?',
            ([id]) => s.teams.filter(t => t.id === id).map(t => ({ id: t.id }))],
    ];

    async function query(sql, params = []) {
        if (s.failNext) { const e = s.failNext; s.failNext = null; throw e; }
        const flat = sql.replace(/\s+/g, ' ').trim();
        if (s.onQuery) await s.onQuery(flat);
        const found = handlers.find(([start]) => flat.startsWith(start));
        if (!found) throw new Error(`fake-db: no handler for SQL: ${flat}`);
        // mysql2 resolves to [rows or result, fields].
        return [found[1](params), []];
    }

    async function getConnection() {
        s.openConnections++;
        let released = false;
        return {
            query,
            beginTransaction: async () => {},
            commit: async () => {},
            rollback: async () => {},
            release: () => { if (!released) { released = true; s.openConnections--; } },
        };
    }

    return { query, getConnection, state: s };
}

// Puts a fake pool where require('../server/db') will find it. Call this
// before requiring anything from server/.
function installFakeDb() {
    const db = createFakeDb();
    const dbPath = require.resolve(path.join(__dirname, '../server/db'));
    require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: db };
    return db;
}

module.exports = { createFakeDb, installFakeDb };
