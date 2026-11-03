const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const pool = require('./db');

// =====================================================================
//  D.A.T.I. — Socket.io wiring for Phase 1 multiplayer core
//  Namespaces: /host (JWT), /player (session_token, guest allowed for
//  team:join), /display (no auth, inbound display:subscribe only).
//  Rooms: event:${event_id}. Rooms are per-namespace in Socket.io, so
//  any event that needs to reach all three namespaces uses
//  broadcastToEvent().
// =====================================================================

function logLine(ns, action, socketId, detail = '') {
    console.log(`[socket] ${ns} ${action.padEnd(12)} socket=${socketId}${detail ? ' ' + detail : ''}`);
}

function computePoints(responseTimeMs, isCorrect, difficulty) {
    if (!isCorrect || responseTimeMs == null) return 0;
    let base;
    if (responseTimeMs <= 10000)      base = 10;
    else if (responseTimeMs <= 20000) base = 7;
    else                              base = 5;
    const mult = difficulty === 'easy' ? 1.0 : difficulty === 'hard' ? 2.0 : 1.5;
    return Math.round(base * mult);
}

// Module-scoped reference populated when attachSocketIO runs, so HTTP
// routes can emit to event rooms without taking a dependency on io
// itself. No new socket event names or payload shapes — only an
// additional caller for existing broadcasts.
let broadcastFn = null;

function attachSocketIO(httpServer) {
    const io = new Server(httpServer);
    const hostNs    = io.of('/host');
    const playerNs  = io.of('/player');
    const displayNs = io.of('/display');

    // eventId -> NodeJS.Timeout. Cancelled when a question locks early
    // (all-submitted path) so the timer doesn't double-fire.
    const questionTimers = new Map();

    const roomName = (eventId) => `event:${eventId}`;

    function broadcastToEvent(eventId, eventName, payload) {
        const room = roomName(eventId);
        hostNs   .in(room).emit(eventName, payload);
        playerNs .in(room).emit(eventName, payload);
        displayNs.in(room).emit(eventName, payload);
    }
    broadcastFn = broadcastToEvent;

    function emitError(socket, code, message) {
        socket.emit('error', { code, message });
    }

    function ackOrEmit(socket, ack, code, message) {
        emitError(socket, code, message);
        if (typeof ack === 'function') ack({ error: { code, message } });
    }

    async function computeScores(eventId) {
        const [rows] = await pool.query(
            `SELECT t.id AS team_id, t.team_name,
                    COALESCE(SUM(ta.points_earned), 0) AS points
               FROM teams t
               LEFT JOIN team_answers ta ON ta.team_id = t.id
              WHERE t.event_id = ?
              GROUP BY t.id, t.team_name
              ORDER BY points DESC, t.id ASC`,
            [eventId]
        );
        return rows.map(r => ({ team_id: r.team_id, team_name: r.team_name, points: Number(r.points) }));
    }

    async function computeScoresWithLastAnswer(eventId, questionId) {
        const scores = await computeScores(eventId);
        if (!questionId) return scores.map(s => ({ ...s, last_answer_correct: null }));
        const [rows] = await pool.query(
            `SELECT ta.team_id, (ta.points_earned > 0) AS correct
               FROM team_answers ta
               JOIN teams t ON t.id = ta.team_id
              WHERE ta.question_id = ? AND t.event_id = ?`,
            [questionId, eventId]
        );
        const correctMap = new Map(rows.map(r => [r.team_id, !!r.correct]));
        return scores.map(s => ({
            ...s,
            last_answer_correct: correctMap.has(s.team_id) ? correctMap.get(s.team_id) : null,
        }));
    }

    function cancelQuestionTimer(eventId) {
        const t = questionTimers.get(eventId);
        if (t) { clearTimeout(t); questionTimers.delete(eventId); }
    }

    function scheduleQuestionTimer(eventId, durationMs) {
        cancelQuestionTimer(eventId);
        const t = setTimeout(() => {
            questionTimers.delete(eventId);
            lockQuestion(eventId, 'timer').catch(e => console.error('timer lock error:', e));
        }, durationMs);
        questionTimers.set(eventId, t);
    }

    // Advances current_question_index, picks next question, sets state
    // to question_active, schedules timer, broadcasts question:show.
    async function showQuestion(eventId) {
        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();
            const [states] = await conn.query(
                'SELECT current_question_index FROM event_state WHERE event_id = ? FOR UPDATE',
                [eventId]
            );
            if (states.length === 0) { await conn.rollback(); return { error: 'no_event_state' }; }
            const nextIndex = states[0].current_question_index + 1;
            const [evs] = await conn.query(
                'SELECT theme_id, question_count, time_limit_seconds FROM events WHERE id = ?',
                [eventId]
            );
            if (evs.length === 0) { await conn.rollback(); return { error: 'event_not_found' }; }
            const ev = evs[0];
            if (nextIndex >= ev.question_count) { await conn.rollback(); return { error: 'no_more_questions' }; }
            // TODO (Phase 6+): snapshot question_ids at start so OFFSET
            // drift from mid-game question edits can't derail the sequence.
            const [questions] = await conn.query(
                `SELECT id, question_text, option_a, option_b, option_c, option_d, difficulty
                   FROM questions
                  WHERE theme_id = ? AND is_active = 1
                  ORDER BY id LIMIT 1 OFFSET ?`,
                [ev.theme_id, nextIndex]
            );
            if (questions.length === 0) { await conn.rollback(); return { error: 'no_more_questions' }; }
            const q = questions[0];
            await conn.query(
                `UPDATE event_state
                    SET current_question_index = ?,
                        current_question_id    = ?,
                        question_started_at    = CURRENT_TIMESTAMP(3),
                        status                 = 'question_active'
                  WHERE event_id = ?`,
                [nextIndex, q.id, eventId]
            );
            await conn.commit();

            broadcastToEvent(eventId, 'question:show', {
                question_id: q.id,
                question_text: q.question_text,
                options: { A: q.option_a, B: q.option_b, C: q.option_c, D: q.option_d },
                difficulty: q.difficulty,
                time_limit_seconds: ev.time_limit_seconds,
                question_number: nextIndex + 1,
                total_questions: ev.question_count,
            });
            scheduleQuestionTimer(eventId, ev.time_limit_seconds * 1000);
            return { ok: true, question_id: q.id, question_number: nextIndex + 1 };
        } catch (err) {
            try { await conn.rollback(); } catch (_) {}
            console.error('showQuestion error:', err);
            return { error: 'db_error' };
        } finally {
            conn.release();
        }
    }

    // Locks the current question: cancels timer, broadcasts lock+reveal,
    // broadcasts scores. Idempotent — re-entry while status is already
    // locked/revealed/ended is a no-op.
    async function lockQuestion(eventId, trigger) {
        const conn = await pool.getConnection();
        let stateRow;
        try {
            await conn.beginTransaction();
            const [states] = await conn.query(
                'SELECT status, current_question_id FROM event_state WHERE event_id = ? FOR UPDATE',
                [eventId]
            );
            if (states.length === 0) { await conn.rollback(); return; }
            stateRow = states[0];
            if (stateRow.status !== 'question_active') {
                await conn.rollback();
                return;
            }
            await conn.query(
                'UPDATE event_state SET status = ? WHERE event_id = ?',
                ['question_locked', eventId]
            );
            await conn.commit();
        } catch (err) {
            try { await conn.rollback(); } catch (_) {}
            console.error('lockQuestion error:', err);
            return;
        } finally {
            conn.release();
        }
        cancelQuestionTimer(eventId);
        console.log(`[socket] event=${eventId} question_locked (${trigger}) qid=${stateRow.current_question_id}`);
        broadcastToEvent(eventId, 'question:locked', { question_id: stateRow.current_question_id });

        // Reveal immediately. UI can animate the lock→reveal transition.
        const [qrows] = await pool.query(
            'SELECT id, correct_answer FROM questions WHERE id = ?',
            [stateRow.current_question_id]
        );
        if (qrows.length > 0) {
            broadcastToEvent(eventId, 'question:revealed', {
                question_id: qrows[0].id,
                correct_option: qrows[0].correct_answer,
                explanation: null,
            });
            await pool.query(
                "UPDATE event_state SET status = 'question_revealed' WHERE event_id = ? AND status = 'question_locked'",
                [eventId]
            );
        }
        const scores = await computeScoresWithLastAnswer(eventId, stateRow.current_question_id);
        broadcastToEvent(eventId, 'scores:update', { scores });
    }

    // =================================================================
    //  /host — JWT auth
    // =================================================================
    hostNs.use((socket, next) => {
        const token = socket.handshake.auth && socket.handshake.auth.token;
        if (!token) { logLine('/host', 'rejected', socket.id, 'reason=no_token'); return next(new Error('no_token')); }
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            socket.data.user = decoded;
            return next();
        } catch (err) {
            logLine('/host', 'rejected', socket.id, 'reason=invalid_token');
            return next(new Error('invalid_token'));
        }
    });

    hostNs.on('connection', (socket) => {
        const u = socket.data.user || {};
        logLine('/host', 'accepted', socket.id, `user=${u.username || u.id || '?'}`);

        socket.on('host:watch_event', async ({ event_id } = {}) => {
            if (!Number.isInteger(event_id)) return emitError(socket, 'invalid_input', 'event_id (int) required');
            const [ev] = await pool.query('SELECT id FROM events WHERE id = ?', [event_id]);
            if (ev.length === 0) return emitError(socket, 'event_not_found', `No event ${event_id}`);
            socket.join(roomName(event_id));
            logLine('/host', 'watch', socket.id, `event=${event_id}`);
        });

        socket.on('host:start_event', async ({ event_id } = {}) => {
            if (!Number.isInteger(event_id)) return emitError(socket, 'invalid_input', 'event_id (int) required');
            try {
                const [evs] = await pool.query('SELECT id, status FROM events WHERE id = ?', [event_id]);
                if (evs.length === 0) return emitError(socket, 'event_not_found', `No event ${event_id}`);
                if (!['published', 'draft'].includes(evs[0].status)) {
                    return emitError(socket, 'invalid_state', `Event status is ${evs[0].status}; expected published|draft`);
                }
                // Ensure event_state row exists, status=lobby, index=-1
                await pool.query(
                    `INSERT INTO event_state (event_id, current_question_index, status)
                         VALUES (?, -1, 'lobby')
                     ON DUPLICATE KEY UPDATE
                         current_question_index = -1,
                         current_question_id    = NULL,
                         question_started_at    = NULL,
                         status                 = 'lobby'`,
                    [event_id]
                );
                await pool.query("UPDATE events SET status = 'live' WHERE id = ?", [event_id]);
                socket.join(roomName(event_id));
                const result = await showQuestion(event_id);
                if (result.error) return emitError(socket, result.error, `start_event: ${result.error}`);
                logLine('/host', 'start', socket.id, `event=${event_id} qnum=${result.question_number}`);
            } catch (err) {
                console.error('host:start_event error:', err);
                emitError(socket, 'db_error', err.code || err.message);
            }
        });

        socket.on('host:next_question', async ({ event_id } = {}) => {
            if (!Number.isInteger(event_id)) return emitError(socket, 'invalid_input', 'event_id (int) required');
            try {
                const [states] = await pool.query('SELECT status FROM event_state WHERE event_id = ?', [event_id]);
                if (states.length === 0) return emitError(socket, 'event_not_found', 'No event_state row');
                if (!['question_revealed', 'question_locked', 'intermission'].includes(states[0].status)) {
                    return emitError(socket, 'invalid_state', `next_question requires revealed|locked|intermission, got ${states[0].status}`);
                }
                const result = await showQuestion(event_id);
                if (result.error === 'no_more_questions') {
                    // Host hit next at the end — graceful: end the game.
                    return handleEnd(socket, event_id);
                }
                if (result.error) return emitError(socket, result.error, `next_question: ${result.error}`);
                logLine('/host', 'next', socket.id, `event=${event_id} qnum=${result.question_number}`);
            } catch (err) {
                console.error('host:next_question error:', err);
                emitError(socket, 'db_error', err.code || err.message);
            }
        });

        socket.on('host:pause_event', async ({ event_id } = {}) => {
            if (!Number.isInteger(event_id)) return emitError(socket, 'invalid_input', 'event_id (int) required');
            cancelQuestionTimer(event_id);
            broadcastToEvent(event_id, 'event:paused', {});
            logLine('/host', 'pause', socket.id, `event=${event_id}`);
        });

        socket.on('host:resume_event', async ({ event_id } = {}) => {
            if (!Number.isInteger(event_id)) return emitError(socket, 'invalid_input', 'event_id (int) required');
            // PHASE 7 HARDENING: resume currently does not re-schedule
            // the remaining timer portion. Pause cancels the timer, and
            // resume only broadcasts `event:resumed`. Host must call
            // next_question to advance. A future hardening pass should
            // track the paused-at offset on event_state and restart a
            // timer of (time_limit - offset) on resume.
            broadcastToEvent(event_id, 'event:resumed', {});
            logLine('/host', 'resume', socket.id, `event=${event_id}`);
        });

        socket.on('host:end_event', ({ event_id } = {}) => handleEnd(socket, event_id));

        socket.on('disconnect', (reason) => logLine('/host', 'disconnect', socket.id, `reason=${reason}`));
    });

    async function handleEnd(socket, event_id) {
        if (!Number.isInteger(event_id)) return emitError(socket, 'invalid_input', 'event_id (int) required');
        try {
            cancelQuestionTimer(event_id);
            await pool.query("UPDATE event_state SET status = 'ended' WHERE event_id = ?", [event_id]);
            await pool.query("UPDATE events SET status = 'completed' WHERE id = ?", [event_id]);
            const scores = await computeScores(event_id);
            let winner_team_id = null;
            let tied_team_ids = [];
            if (scores.length > 0) {
                const top = scores[0].points;
                const topTeams = scores.filter(s => s.points === top).map(s => s.team_id);
                if (topTeams.length === 1) winner_team_id = topTeams[0];
                else tied_team_ids = topTeams;
            }
            broadcastToEvent(event_id, 'game:ended', { final_scores: scores, winner_team_id, tied_team_ids });
            logLine('/host', 'end', socket.id, `event=${event_id} teams=${scores.length}`);
        } catch (err) {
            console.error('host:end_event error:', err);
            emitError(socket, 'db_error', err.code || err.message);
        }
    }

    // =================================================================
    //  /player — session_token auth, with guest connections allowed
    //  specifically for team:join (chicken-and-egg avoidance).
    // =================================================================
    playerNs.use(async (socket, next) => {
        const sessionToken = socket.handshake.auth && socket.handshake.auth.session_token;
        if (!sessionToken) {
            socket.data.guest = true;
            return next();
        }
        try {
            const [rows] = await pool.query(
                'SELECT id, event_id, team_name FROM teams WHERE session_token = ? LIMIT 1',
                [sessionToken]
            );
            if (rows.length === 0) {
                logLine('/player', 'rejected', socket.id, 'reason=unknown_token');
                return next(new Error('unknown_token'));
            }
            socket.data.team = rows[0];
            return next();
        } catch (err) {
            logLine('/player', 'rejected', socket.id, `reason=db_error:${err.code || err.message}`);
            return next(new Error('db_error'));
        }
    });

    playerNs.on('connection', (socket) => {
        if (socket.data.team) {
            const t = socket.data.team;
            socket.join(roomName(t.event_id));
            logLine('/player', 'accepted', socket.id, `team=${t.id} event=${t.event_id} name="${t.team_name}"`);
        } else {
            logLine('/player', 'accepted', socket.id, 'guest=true');
        }

        socket.on('team:join', async (data, ack) => {
            if (socket.data.team) return ackOrEmit(socket, ack, 'already_joined', 'Connection already tied to a team');
            const { event_id, team_name, member_count } = data || {};
            if (!Number.isInteger(event_id) || typeof team_name !== 'string' || team_name.trim().length === 0 || team_name.length > 100) {
                return ackOrEmit(socket, ack, 'invalid_input', 'event_id (int) and team_name (1-100 chars) required');
            }
            const mc = Number.isInteger(member_count) && member_count > 0 ? member_count : 1;
            try {
                const [evs] = await pool.query('SELECT id, status FROM events WHERE id = ?', [event_id]);
                if (evs.length === 0) return ackOrEmit(socket, ack, 'event_not_found', `No event ${event_id}`);
                if (!['published', 'live'].includes(evs[0].status)) {
                    return ackOrEmit(socket, ack, 'event_not_joinable', `Event status is ${evs[0].status}`);
                }
                const session_token = crypto.randomBytes(32).toString('hex');
                const [ins] = await pool.query(
                    'INSERT INTO teams (event_id, team_name, session_token, member_count) VALUES (?, ?, ?, ?)',
                    [event_id, team_name.trim(), session_token, mc]
                );
                const team_id = ins.insertId;
                socket.data.team  = { id: team_id, event_id, team_name: team_name.trim() };
                socket.data.guest = false;
                socket.join(roomName(event_id));
                if (typeof ack === 'function') ack({ session_token, team_id });
                const [countRows] = await pool.query('SELECT COUNT(*) AS n FROM teams WHERE event_id = ?', [event_id]);
                broadcastToEvent(event_id, 'lobby:team_joined', {
                    team_id, team_name: team_name.trim(), member_count: mc, total_teams: countRows[0].n,
                });
                logLine('/player', 'join', socket.id, `team=${team_id} event=${event_id}`);
            } catch (err) {
                if (err.code === 'ER_DUP_ENTRY') {
                    return ackOrEmit(socket, ack, 'duplicate_team_name', 'Team name already used for this event');
                }
                console.error('team:join error:', err);
                ackOrEmit(socket, ack, 'db_error', err.code || err.message);
            }
        });

        socket.on('team:rejoin', async (data, ack) => {
            // Handshake already authenticated via session_token. This
            // event is for a state-snapshot back to the reconnecting
            // socket — no broadcast.
            if (!socket.data.team) return ackOrEmit(socket, ack, 'not_authenticated', 'No session_token in handshake');
            const t = socket.data.team;
            socket.join(roomName(t.event_id));
            try {
                const [states] = await pool.query(
                    'SELECT status, current_question_id, question_started_at, current_question_index FROM event_state WHERE event_id = ?',
                    [t.event_id]
                );
                const state = states[0] || null;
                let current_question = null;
                let seconds_remaining = null;
                if (state && state.status === 'question_active' && state.current_question_id) {
                    const [qs] = await pool.query(
                        `SELECT q.id, q.question_text, q.option_a, q.option_b, q.option_c, q.option_d, q.difficulty,
                                e.time_limit_seconds
                           FROM questions q JOIN events e ON e.id = ?
                          WHERE q.id = ?`,
                        [t.event_id, state.current_question_id]
                    );
                    if (qs.length > 0) {
                        const q = qs[0];
                        current_question = {
                            question_id: q.id,
                            question_text: q.question_text,
                            options: { A: q.option_a, B: q.option_b, C: q.option_c, D: q.option_d },
                            difficulty: q.difficulty,
                            time_limit_seconds: q.time_limit_seconds,
                            question_number: state.current_question_index + 1,
                        };
                        const started = state.question_started_at ? new Date(state.question_started_at).getTime() : Date.now();
                        const elapsed = Date.now() - started;
                        seconds_remaining = Math.max(0, Math.floor((q.time_limit_seconds * 1000 - elapsed) / 1000));
                    }
                }
                const scores = await computeScores(t.event_id);
                if (typeof ack === 'function') {
                    ack({
                        team_id: t.id,
                        event_id: t.event_id,
                        status: state ? state.status : 'lobby',
                        current_question_index: state ? state.current_question_index : -1,
                        current_question,
                        seconds_remaining,
                        scores,
                    });
                }
                logLine('/player', 'rejoin', socket.id, `team=${t.id} status=${state ? state.status : 'none'}`);
            } catch (err) {
                console.error('team:rejoin error:', err);
                ackOrEmit(socket, ack, 'db_error', err.code || err.message);
            }
        });

        socket.on('team:submit_answer', async (data, ack) => {
            if (!socket.data.team) return ackOrEmit(socket, ack, 'not_authenticated', 'No session_token in handshake');
            const team = socket.data.team;
            const { question_id, selected_option, response_time_ms } = data || {};
            if (!Number.isInteger(question_id)) return ackOrEmit(socket, ack, 'invalid_input', 'question_id (int) required');
            if (selected_option !== null && !['A','B','C','D'].includes(selected_option)) {
                return ackOrEmit(socket, ack, 'invalid_input', 'selected_option must be A|B|C|D|null');
            }
            if (typeof response_time_ms !== 'number' || response_time_ms < 0) {
                return ackOrEmit(socket, ack, 'invalid_timing', 'response_time_ms must be a non-negative number');
            }

            const conn = await pool.getConnection();
            try {
                await conn.beginTransaction();
                const [states] = await conn.query(
                    'SELECT status, current_question_id, question_started_at FROM event_state WHERE event_id = ? FOR UPDATE',
                    [team.event_id]
                );
                if (states.length === 0) { await conn.rollback(); return ackOrEmit(socket, ack, 'invalid_state', 'No event_state'); }
                const state = states[0];
                if (state.status !== 'question_active') { await conn.rollback(); return ackOrEmit(socket, ack, 'invalid_state', `status=${state.status}`); }
                if (state.current_question_id !== question_id) { await conn.rollback(); return ackOrEmit(socket, ack, 'wrong_question', `current=${state.current_question_id}, got=${question_id}`); }

                // Timing sanity: allow 1s tolerance over server elapsed.
                const started = state.question_started_at ? new Date(state.question_started_at).getTime() : Date.now();
                const elapsed = Date.now() - started;
                if (response_time_ms > elapsed + 1000) {
                    await conn.rollback();
                    return ackOrEmit(socket, ack, 'invalid_timing', `response_time_ms=${response_time_ms} > elapsed=${elapsed}+1000`);
                }

                // Fetch question for scoring
                const [qrows] = await conn.query(
                    'SELECT id, correct_answer, difficulty FROM questions WHERE id = ?',
                    [question_id]
                );
                if (qrows.length === 0) { await conn.rollback(); return ackOrEmit(socket, ack, 'unknown_question', `question_id=${question_id}`); }
                const q = qrows[0];
                const isCorrect = selected_option != null && selected_option === q.correct_answer;
                const points = computePoints(response_time_ms, isCorrect, q.difficulty);

                try {
                    await conn.query(
                        `INSERT INTO team_answers (team_id, question_id, selected_option, response_time_ms, points_earned)
                         VALUES (?, ?, ?, ?, ?)`,
                        [team.id, question_id, selected_option, response_time_ms, points]
                    );
                } catch (insErr) {
                    if (insErr.code === 'ER_DUP_ENTRY') {
                        await conn.rollback();
                        return ackOrEmit(socket, ack, 'already_answered', 'Team already answered this question');
                    }
                    throw insErr;
                }

                // Count submissions for this question in this event to decide if lock fires early.
                const [cnt] = await conn.query(
                    `SELECT COUNT(*) AS answered, (SELECT COUNT(*) FROM teams WHERE event_id = ?) AS total
                       FROM team_answers ta JOIN teams t ON t.id = ta.team_id
                      WHERE t.event_id = ? AND ta.question_id = ?`,
                    [team.event_id, team.event_id, question_id]
                );
                const allSubmitted = cnt[0].total > 0 && cnt[0].answered >= cnt[0].total;
                await conn.commit();

                if (typeof ack === 'function') ack({ accepted: true, points_earned: points, is_correct: isCorrect });
                logLine('/player', 'answer', socket.id, `team=${team.id} q=${question_id} opt=${selected_option} pts=${points} rt=${response_time_ms}ms`);

                // Always update scores after a submission.
                const scores = await computeScoresWithLastAnswer(team.event_id, question_id);
                broadcastToEvent(team.event_id, 'scores:update', { scores });

                if (allSubmitted) {
                    lockQuestion(team.event_id, 'all_submitted').catch(e => console.error('lock (all) error:', e));
                }
            } catch (err) {
                try { await conn.rollback(); } catch (_) {}
                console.error('team:submit_answer error:', err);
                ackOrEmit(socket, ack, 'db_error', err.code || err.message);
            } finally {
                conn.release();
            }
        });

        socket.on('team:use_lifeline', async (_data, ack) => {
            // Phase 5 stub: mark lifeline_used=1, broadcast lifeline:used.
            // Browser iframe / 30s timer / TV countdown are Phase 5.
            if (!socket.data.team) return ackOrEmit(socket, ack, 'not_authenticated', 'No session_token in handshake');
            const team = socket.data.team;
            try {
                const [rows] = await pool.query('SELECT lifeline_used FROM teams WHERE id = ?', [team.id]);
                if (rows.length === 0) return ackOrEmit(socket, ack, 'not_found', 'team row missing');
                if (rows[0].lifeline_used) return ackOrEmit(socket, ack, 'lifeline_already_used', 'Team has already used lifeline');
                await pool.query('UPDATE teams SET lifeline_used = 1 WHERE id = ?', [team.id]);
                if (typeof ack === 'function') ack({ accepted: true });
                broadcastToEvent(team.event_id, 'lifeline:used', { team_id: team.id, team_name: team.team_name });
                logLine('/player', 'lifeline', socket.id, `team=${team.id}`);
            } catch (err) {
                console.error('team:use_lifeline error:', err);
                ackOrEmit(socket, ack, 'db_error', err.code || err.message);
            }
        });

        socket.on('disconnect', (reason) => {
            const t = socket.data.team;
            logLine('/player', 'disconnect', socket.id, `reason=${reason}${t ? ' team=' + t.id : ''}`);
        });
    });

    // =================================================================
    //  /display — no auth. Only inbound event is display:subscribe.
    // =================================================================
    displayNs.on('connection', (socket) => {
        logLine('/display', 'accepted', socket.id, '');

        socket.on('display:subscribe', async ({ event_id } = {}) => {
            if (!Number.isInteger(event_id)) return emitError(socket, 'invalid_input', 'event_id (int) required');
            const [ev] = await pool.query('SELECT id FROM events WHERE id = ?', [event_id]);
            if (ev.length === 0) return emitError(socket, 'event_not_found', `No event ${event_id}`);
            socket.join(roomName(event_id));
            logLine('/display', 'subscribe', socket.id, `event=${event_id}`);
        });

        socket.on('disconnect', (reason) => logLine('/display', 'disconnect', socket.id, `reason=${reason}`));
    });

    return io;
}

module.exports = attachSocketIO;
module.exports.broadcast = (eventId, eventName, payload) => {
    if (broadcastFn) broadcastFn(eventId, eventName, payload);
};
module.exports.computePoints = computePoints;
