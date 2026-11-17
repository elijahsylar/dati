// The Socket.io game server (server/socket.js) end to end: a real
// Socket.io server on a free local port, real socket.io-client sockets,
// and an in-memory fake of the database pool (test/fake-db.js), so no
// MySQL is needed. Every test closes its sockets and its server.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const jwt = require('jsonwebtoken');
const { io: connect } = require('socket.io-client');
const { installFakeDb } = require('./fake-db');

// Generated for each run: no secret is written in the tests.
process.env.JWT_SECRET = require('node:crypto').randomBytes(32).toString('hex');
const db = installFakeDb();
const attachSocketIO = require('../server/socket');
const displayRoutes = require('../server/routes/display');

// The server logs one line per socket action; keep the test output readable.
console.log = () => {};

const WAIT_MS = 3000;
const TEST_OPTS = { timeout: 15000 };

function hostToken(claims = {}, secret = process.env.JWT_SECRET, opts = { expiresIn: '5m' }) {
    return jwt.sign({ id: 2, username: 'host1', role: 'host', ...claims }, secret, opts);
}

function question(id, themeId, correct, difficulty = 'easy') {
    return {
        id, theme_id: themeId, is_active: 1, question_text: `Question ${id}?`,
        option_a: 'a', option_b: 'b', option_c: 'c', option_d: 'd',
        correct_answer: correct, difficulty,
    };
}

// Event 1: published, two questions, 5 s limit. Event 2: a draft.
// Event 3: published, one question, 1 s limit (for the timer test).
// Events 4 and 5: cancelled and completed.
function seed() {
    const s = db.state;
    s.events = [
        { id: 1, title: 'Tuesday Trivia', theme_id: 1, status: 'published', join_code: 'ABC234', question_count: 2, time_limit_seconds: 5 },
        { id: 2, title: 'Draft Night', theme_id: 1, status: 'draft', join_code: null, question_count: 2, time_limit_seconds: 5 },
        { id: 3, title: 'Quick Round', theme_id: 2, status: 'published', join_code: 'XYZ789', question_count: 1, time_limit_seconds: 1 },
        { id: 4, title: 'Called Off', theme_id: 1, status: 'cancelled', join_code: 'CAN234', question_count: 2, time_limit_seconds: 5 },
        { id: 5, title: 'Last Week', theme_id: 1, status: 'completed', join_code: 'DNE234', question_count: 2, time_limit_seconds: 5 },
    ];
    s.questions = [question(11, 1, 'B'), question(12, 1, 'C', 'hard'), question(21, 2, 'A')];
    s.eventState = [];
    s.teams = [];
    s.teamAnswers = [];
    s.nextTeamId = 1;
    s.failNext = null;
    s.onQuery = null;
}

// Starts a server for one test and registers its teardown.
async function start(t) {
    seed();
    const app = express();
    app.use('/api/display', displayRoutes);
    const server = http.createServer(app);
    const io = attachSocketIO(server);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    const sockets = [];

    t.after(async () => {
        for (const sock of sockets) sock.disconnect();
        // Closes the Socket.io server and the HTTP server under it.
        await new Promise((resolve) => io.close(resolve));
        assert.equal(db.state.openConnections, 0, 'every pooled connection was released');
    });

    function open(namespace, auth) {
        const sock = connect(url + namespace, { auth, transports: ['websocket'], reconnection: false, forceNew: true });
        sockets.push(sock);
        return sock;
    }

    // Resolves once connected; rejects with the server's refusal.
    function connected(sock) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('connect timed out')), WAIT_MS);
            sock.once('connect', () => { clearTimeout(timer); resolve(sock); });
            sock.once('connect_error', (err) => { clearTimeout(timer); reject(err); });
        });
    }

    async function waitFor(check, what) {
        const deadline = Date.now() + WAIT_MS;
        while (!check()) {
            if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
            await new Promise((resolve) => setTimeout(resolve, 5));
        }
    }

    const inRoom = (namespace, sock, eventId) => {
        const room = io.of(namespace).adapter.rooms.get(`event:${eventId}`);
        return !!room && room.has(sock.id);
    };

    async function host(eventId, claims) {
        const sock = await connected(open('/host', { token: hostToken(claims) }));
        if (eventId != null) {
            sock.emit('host:watch_event', { event_id: eventId });
            await waitFor(() => inRoom('/host', sock, eventId), 'host to watch the event');
        }
        return sock;
    }

    async function display(eventId) {
        const sock = await connected(open('/display'));
        sock.emit('display:subscribe', { event_id: eventId });
        await waitFor(() => inRoom('/display', sock, eventId), 'display to subscribe');
        return sock;
    }

    // A guest connection that joins as a new team.
    async function team(eventId, name) {
        const sock = await connected(open('/player'));
        const joined = await ask(sock, 'team:join', { event_id: eventId, team_name: name });
        assert.ok(joined.session_token, `team ${name} got a session token`);
        return { sock, ...joined };
    }

    async function snapshot(eventId) {
        // No keep-alive: an idle kept-alive connection would hold the server open in teardown.
        const res = await fetch(`${url}/api/display/${eventId}/snapshot`, { headers: { connection: 'close' } });
        return { status: res.status, body: await res.json() };
    }

    return { io, url, open, connected, host, display, team, snapshot, waitFor };
}

// Emits and resolves with the acknowledgement.
function ask(sock, event, data) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`no ack for ${event}`)), WAIT_MS);
        sock.emit(event, data, (reply) => { clearTimeout(timer); resolve(reply); });
    });
}

// Resolves with the payload of the next `event` the socket receives.
function next(sock, event, waitMs = WAIT_MS) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), waitMs);
        sock.once(event, (payload) => { clearTimeout(timer); resolve(payload); });
    });
}

// Ends the event. That cancels its question timer, which would otherwise
// keep the test process alive until it fires.
async function end(hostSock, eventId) {
    const ended = next(hostSock, 'game:ended');
    hostSock.emit('host:end_event', { event_id: eventId });
    return ended;
}

// ---------------------------------------------------------------------
//  Host authentication
// ---------------------------------------------------------------------

test('/host refuses a connection with no token', TEST_OPTS, async (t) => {
    const h = await start(t);
    await assert.rejects(h.connected(h.open('/host')), /no_token/);
    await assert.rejects(h.connected(h.open('/host', {})), /no_token/);
});

test('/host refuses a token that is forged, expired or not a token', TEST_OPTS, async (t) => {
    const h = await start(t);
    const forged = hostToken({}, 'some-other-secret');
    await assert.rejects(h.connected(h.open('/host', { token: forged })), /invalid_token/);
    const expired = hostToken({}, process.env.JWT_SECRET, { expiresIn: -10 });
    await assert.rejects(h.connected(h.open('/host', { token: expired })), /invalid_token/);
    await assert.rejects(h.connected(h.open('/host', { token: 'not-a-jwt' })), /invalid_token/);
});

test('/host refuses a valid token whose role is not admin or host', TEST_OPTS, async (t) => {
    const h = await start(t);
    const sign = (claims) => jwt.sign(claims, process.env.JWT_SECRET, { expiresIn: '5m' });
    await assert.rejects(h.connected(h.open('/host', { token: sign({ id: 3, username: 'legacy' }) })), /forbidden_role/);
    await assert.rejects(h.connected(h.open('/host', { token: sign({ id: 4, username: 'other', role: 'player' }) })), /forbidden_role/);
    await assert.rejects(h.connected(h.open('/host', { token: sign({ id: 5, username: 'caps', role: 'Admin' }) })), /forbidden_role/);

    // Both real roles may run a game.
    assert.ok((await h.host(1, { role: 'host' })).connected);
    assert.ok((await h.host(1, { id: 1, username: 'admin', role: 'admin' })).connected);
});

test('/host accepts a valid token and validates what it is asked to watch', TEST_OPTS, async (t) => {
    const h = await start(t);
    const hostSock = await h.host();
    assert.ok(hostSock.connected);

    let err = next(hostSock, 'error');
    hostSock.emit('host:watch_event', { event_id: 999 });
    assert.equal((await err).code, 'event_not_found');

    err = next(hostSock, 'error');
    hostSock.emit('host:watch_event', null); // a null payload must not crash the server
    assert.equal((await err).code, 'invalid_input');

    err = next(hostSock, 'error');
    hostSock.emit('host:start_event', { event_id: 'one' });
    assert.equal((await err).code, 'invalid_input');
});

test('a database error in a host handler is reported, and the server keeps running', TEST_OPTS, async (t) => {
    const h = await start(t);
    const hostSock = await h.host();
    const silenced = console.error;
    console.error = () => {};
    t.after(() => { console.error = silenced; });

    db.state.failNext = Object.assign(new Error('connection lost'), { code: 'PROTOCOL_CONNECTION_LOST' });
    const err = next(hostSock, 'error');
    hostSock.emit('host:watch_event', { event_id: 1 });
    assert.deepEqual(await err, { code: 'db_error', message: 'PROTOCOL_CONNECTION_LOST' });

    // Still serving: the same socket can watch the event afterwards.
    hostSock.emit('host:watch_event', { event_id: 1 });
    await h.waitFor(() => h.io.of('/host').adapter.rooms.get('event:1')?.has(hostSock.id), 'watch after error');
});

// ---------------------------------------------------------------------
//  Team join and session tokens
// ---------------------------------------------------------------------

test('a guest joins as a team, gets a session token, and the lobby is told', TEST_OPTS, async (t) => {
    const h = await start(t);
    const hostSock = await h.host(1);
    const tv = await h.display(1);

    const hostSaw = next(hostSock, 'lobby:team_joined');
    const tvSaw = next(tv, 'lobby:team_joined');
    const guest = await h.connected(h.open('/player'));
    const joined = await ask(guest, 'team:join', { event_id: 1, team_name: '  Quizzly Bears  ', member_count: 4 });

    assert.match(joined.session_token, /^[0-9a-f]{64}$/);
    assert.equal(joined.team_id, 1);
    const expected = { team_id: 1, team_name: 'Quizzly Bears', member_count: 4, total_teams: 1 };
    assert.deepEqual(await hostSaw, expected);
    assert.deepEqual(await tvSaw, expected);
    assert.equal(db.state.teams[0].session_token, joined.session_token);

    // The same connection cannot join twice.
    const twice = await ask(guest, 'team:join', { event_id: 1, team_name: 'Another' });
    assert.equal(twice.error.code, 'already_joined');
});

test('team:join refuses bad input, unknown or draft events, and a taken name', TEST_OPTS, async (t) => {
    const h = await start(t);
    await h.team(1, 'Quizzly Bears');

    const guest = await h.connected(h.open('/player'));
    const code = async (data) => (await ask(guest, 'team:join', data)).error.code;
    assert.equal(await code(null), 'invalid_input');
    assert.equal(await code({ event_id: 1, team_name: '   ' }), 'invalid_input');
    assert.equal(await code({ event_id: 1, team_name: 'x'.repeat(101) }), 'invalid_input');
    assert.equal(await code({ event_id: '1', team_name: 'Late Entry' }), 'invalid_input');
    assert.equal(await code({ event_id: 999, team_name: 'Late Entry' }), 'event_not_found');
    assert.equal(await code({ event_id: 2, team_name: 'Late Entry' }), 'event_not_joinable');
    assert.equal(await code({ event_id: 1, team_name: 'Quizzly Bears' }), 'duplicate_team_name');
    assert.equal(db.state.teams.length, 1);
});

test('/player ties a connection to its team by session token, and refuses an unknown one', TEST_OPTS, async (t) => {
    const h = await start(t);
    const first = await h.team(1, 'Quizzly Bears');
    first.sock.disconnect();

    await assert.rejects(h.connected(h.open('/player', { session_token: 'f'.repeat(64) })), /unknown_token/);

    const back = await h.connected(h.open('/player', { session_token: first.session_token }));
    // Already tied to the team: it is in the event room and cannot join again.
    await h.waitFor(() => h.io.of('/player').adapter.rooms.get('event:1')?.has(back.id), 'rejoined socket in room');
    const again = await ask(back, 'team:join', { event_id: 1, team_name: 'Someone Else' });
    assert.equal(again.error.code, 'already_joined');

    // A guest has no team, so team-only events are refused.
    const guest = await h.connected(h.open('/player'));
    const answer = await ask(guest, 'team:submit_answer', { question_id: 11, selected_option: 'B', response_time_ms: 10 });
    assert.equal(answer.error.code, 'not_authenticated');
    assert.equal((await ask(guest, 'team:rejoin', {})).error.code, 'not_authenticated');
    assert.equal((await ask(guest, 'team:use_lifeline', {})).error.code, 'not_authenticated');
});

// ---------------------------------------------------------------------
//  Starting a question, answers, scoring and timing
// ---------------------------------------------------------------------

test('host:start_event shows the first question to teams, host and display, without the answer', TEST_OPTS, async (t) => {
    const h = await start(t);
    const hostSock = await h.host(1);
    const tv = await h.display(1);
    const bears = await h.team(1, 'Quizzly Bears');

    const shown = [next(bears.sock, 'question:show'), next(hostSock, 'question:show'), next(tv, 'question:show')];
    hostSock.emit('host:start_event', { event_id: 1 });
    const [toTeam, toHost, toTv] = await Promise.all(shown);

    assert.deepEqual(toTeam, {
        question_id: 11,
        question_text: 'Question 11?',
        options: { A: 'a', B: 'b', C: 'c', D: 'd' },
        difficulty: 'easy',
        time_limit_seconds: 5,
        question_number: 1,
        total_questions: 2,
    });
    assert.deepEqual(toHost, toTeam);
    assert.deepEqual(toTv, toTeam);
    assert.ok(!JSON.stringify(toTeam).includes('correct'));
    assert.equal(db.state.events[0].status, 'live');
    assert.equal(db.state.eventState[0].status, 'question_active');

    await end(hostSock, 1);
});

test('host:start_event refuses a draft, cancelled or completed event and changes nothing', TEST_OPTS, async (t) => {
    const h = await start(t);
    const hostSock = await h.host();
    const tv = await h.display(2);
    let shown = false;
    tv.on('question:show', () => { shown = true; });

    for (const [eventId, status] of [[2, 'draft'], [4, 'cancelled'], [5, 'completed']]) {
        const err = next(hostSock, 'error');
        hostSock.emit('host:start_event', { event_id: eventId });
        const refused = await err;
        assert.equal(refused.code, 'event_not_published', status);
        assert.match(refused.message, new RegExp(`This event is ${status}\\.`));
        assert.equal(db.state.events.find((e) => e.id === eventId).status, status, `${status} event left as it was`);
        // The refused host is not put in the event's room either.
        assert.ok(!h.io.of('/host').adapter.rooms.get(`event:${eventId}`)?.has(hostSock.id));
    }
    assert.equal(db.state.eventState.length, 0, 'no game state was created');
    assert.equal(shown, false, 'nothing was broadcast');

    const err = next(hostSock, 'error');
    hostSock.emit('host:start_event', { event_id: 999 });
    assert.equal((await err).code, 'event_not_found');
});

test('host:start_event refuses an event that is already live, and the game in play is untouched', TEST_OPTS, async (t) => {
    const h = await start(t);
    const hostSock = await h.host(1);
    const bears = await h.team(1, 'Quizzly Bears');
    await h.team(1, 'Night Owls');

    const shown = next(bears.sock, 'question:show');
    hostSock.emit('host:start_event', { event_id: 1 });
    await shown;
    await ask(bears.sock, 'team:submit_answer', { question_id: 11, selected_option: 'B', response_time_ms: 100 });
    const before = JSON.stringify(db.state.eventState);

    // A second host console (or a second press of Start) is refused.
    const second = await h.host(1, { id: 1, username: 'admin', role: 'admin' });
    let shownAgain = false;
    bears.sock.on('question:show', () => { shownAgain = true; });
    for (const sock of [second, hostSock]) {
        const err = next(sock, 'error');
        sock.emit('host:start_event', { event_id: 1 });
        const refused = await err;
        assert.equal(refused.code, 'already_started');
        assert.equal(refused.message, 'This event has already been started.');
    }
    assert.equal(JSON.stringify(db.state.eventState), before, 'question index and clock were not reset');
    assert.equal(shownAgain, false);
    assert.equal(db.state.teamAnswers.length, 1);

    // The second console still follows the game it is watching.
    const ended = next(second, 'game:ended');
    await end(hostSock, 1);
    await ended;
});

test('host:start_event lets only one of two simultaneous starts through', TEST_OPTS, async (t) => {
    const h = await start(t);
    const a = await h.host(1);
    const b = await h.host(1);
    const bears = await h.team(1, 'Quizzly Bears');
    let shows = 0;
    bears.sock.on('question:show', () => { shows++; });

    // Hold both status checks until both have been asked, so each start
    // sees the event as published before either has made it live.
    let waiting = 0;
    let release;
    const bothAsked = new Promise((resolve) => { release = resolve; });
    db.state.onQuery = async (sql) => {
        if (!sql.startsWith('SELECT id, status FROM events')) return;
        if (++waiting === 2) release();
        await bothAsked;
    };

    const refusals = [];
    a.on('error', (e) => refusals.push(e.code));
    b.on('error', (e) => refusals.push(e.code));
    a.emit('host:start_event', { event_id: 1 });
    b.emit('host:start_event', { event_id: 1 });
    await h.waitFor(() => refusals.length === 1 && shows >= 1, 'one start and one refusal');
    db.state.onQuery = null;
    assert.deepEqual(refusals, ['already_started']);
    assert.equal(shows, 1);
    assert.equal(db.state.eventState[0].current_question_index, 0);

    await end(a, 1);
});

test('a correct answer is scored on the server, saved once, and the scores go out', TEST_OPTS, async (t) => {
    const h = await start(t);
    const hostSock = await h.host(1);
    const bears = await h.team(1, 'Quizzly Bears');
    const owls = await h.team(1, 'Night Owls');

    const shown = next(owls.sock, 'question:show');
    hostSock.emit('host:start_event', { event_id: 1 });
    await shown;

    const scoresToHost = next(hostSock, 'scores:update');
    const reply = await ask(bears.sock, 'team:submit_answer', { question_id: 11, selected_option: 'B', response_time_ms: 200 });
    assert.deepEqual(reply, { accepted: true, points_earned: 10, is_correct: true });
    assert.deepEqual((await scoresToHost).scores, [
        { team_id: bears.team_id, team_name: 'Quizzly Bears', points: 10, last_answer_correct: true },
        { team_id: owls.team_id, team_name: 'Night Owls', points: 0, last_answer_correct: null },
    ]);

    // One answer per team per question, and the first one stands.
    const second = await ask(bears.sock, 'team:submit_answer', { question_id: 11, selected_option: 'A', response_time_ms: 300 });
    assert.equal(second.error.code, 'already_answered');
    assert.equal(db.state.teamAnswers.length, 1);
    assert.equal(db.state.teamAnswers[0].points_earned, 10);

    // Input checks.
    const code = async (data) => (await ask(owls.sock, 'team:submit_answer', data)).error.code;
    assert.equal(await code(null), 'invalid_input');
    assert.equal(await code({ question_id: 11, selected_option: 'E', response_time_ms: 100 }), 'invalid_input');
    assert.equal(await code({ question_id: 11, selected_option: 'B', response_time_ms: -1 }), 'invalid_timing');
    assert.equal(await code({ question_id: 11, selected_option: 'B' }), 'invalid_timing');
    assert.equal(await code({ question_id: 12, selected_option: 'B', response_time_ms: 100 }), 'wrong_question');
    assert.equal(db.state.teamAnswers.length, 1);

    // A wrong answer is accepted and earns nothing.
    const wrong = await ask(owls.sock, 'team:submit_answer', { question_id: 11, selected_option: 'D', response_time_ms: 100 });
    assert.deepEqual(wrong, { accepted: true, points_earned: 0, is_correct: false });

    await end(hostSock, 1);
});

test('timing: a response time longer than the server clock allows is refused', TEST_OPTS, async (t) => {
    const h = await start(t);
    const hostSock = await h.host(1);
    const bears = await h.team(1, 'Quizzly Bears');
    await h.team(1, 'Night Owls'); // a second team, so one answer does not lock the question

    const shown = next(bears.sock, 'question:show');
    hostSock.emit('host:start_event', { event_id: 1 });
    await shown;

    // The question started a moment ago; claiming 4 s is past the 1 s slack.
    const early = await ask(bears.sock, 'team:submit_answer', { question_id: 11, selected_option: 'B', response_time_ms: 4000 });
    assert.equal(early.error.code, 'invalid_timing');
    assert.equal(db.state.teamAnswers.length, 0);

    // Inside the slack it is accepted.
    const ok = await ask(bears.sock, 'team:submit_answer', { question_id: 11, selected_option: 'B', response_time_ms: 900 });
    assert.equal(ok.accepted, true);

    await end(hostSock, 1);
});

test('timing: slower correct answers earn less (10, 7 and 5 before the difficulty multiplier)', TEST_OPTS, async (t) => {
    const h = await start(t);
    const hostSock = await h.host(1);
    const fast = await h.team(1, 'Fast');
    const mid = await h.team(1, 'Middle');
    const slow = await h.team(1, 'Slow');
    await h.team(1, 'Silent'); // never answers, so the question stays open

    const shown = next(fast.sock, 'question:show');
    hostSock.emit('host:start_event', { event_id: 1 });
    await shown;
    // Move the server's start time 25 s into the past, so slow answers are plausible.
    db.state.eventState[0].question_started_at = new Date(Date.now() - 25000);

    const answer = (who, ms) => ask(who.sock, 'team:submit_answer', { question_id: 11, selected_option: 'B', response_time_ms: ms });
    assert.equal((await answer(fast, 9000)).points_earned, 10);
    assert.equal((await answer(mid, 15000)).points_earned, 7);
    assert.equal((await answer(slow, 24000)).points_earned, 5);

    await end(hostSock, 1);
});

test('when every team has answered the question locks early and the answer is revealed', TEST_OPTS, async (t) => {
    const h = await start(t);
    const hostSock = await h.host(1);
    const tv = await h.display(1);
    const bears = await h.team(1, 'Quizzly Bears');
    const owls = await h.team(1, 'Night Owls');

    const shown = next(owls.sock, 'question:show');
    hostSock.emit('host:start_event', { event_id: 1 });
    await shown;

    const locked = next(tv, 'question:locked');
    const revealed = next(tv, 'question:revealed');
    await ask(bears.sock, 'team:submit_answer', { question_id: 11, selected_option: 'B', response_time_ms: 100 });
    assert.equal(db.state.eventState[0].status, 'question_active'); // one team still to answer
    await ask(owls.sock, 'team:submit_answer', { question_id: 11, selected_option: 'A', response_time_ms: 100 });

    assert.deepEqual(await locked, { question_id: 11 });
    assert.deepEqual(await revealed, { question_id: 11, correct_option: 'B', explanation: null });
    await h.waitFor(() => db.state.eventState[0].status === 'question_revealed', 'state to be revealed');

    // The answer is out: nothing more is accepted for this question.
    const late = await h.team(1, 'Latecomers');
    const reply = await ask(late.sock, 'team:submit_answer', { question_id: 11, selected_option: 'B', response_time_ms: 100 });
    assert.equal(reply.error.code, 'invalid_state');

    await end(hostSock, 1);
});

test('the server timer locks and reveals a question nobody answered', TEST_OPTS, async (t) => {
    const h = await start(t);
    const hostSock = await h.host(3);
    const bears = await h.team(3, 'Quizzly Bears');

    const shown = next(bears.sock, 'question:show');
    const locked = next(bears.sock, 'question:locked');
    const revealed = next(bears.sock, 'question:revealed');
    hostSock.emit('host:start_event', { event_id: 3 });
    const startedAt = Date.now();
    assert.equal((await shown).time_limit_seconds, 1);

    assert.deepEqual(await locked, { question_id: 21 });
    assert.ok(Date.now() - startedAt >= 900, 'not locked before the 1 s limit');
    assert.deepEqual(await revealed, { question_id: 21, correct_option: 'A', explanation: null });
});

test('host:next_question advances, and past the last question the game ends with a winner', TEST_OPTS, async (t) => {
    const h = await start(t);
    const hostSock = await h.host(1);
    const bears = await h.team(1, 'Quizzly Bears');
    const owls = await h.team(1, 'Night Owls');
    const answerBoth = async (qid, bearsPick, owlsPick) => {
        const revealed = next(hostSock, 'question:revealed');
        await ask(bears.sock, 'team:submit_answer', { question_id: qid, selected_option: bearsPick, response_time_ms: 100 });
        await ask(owls.sock, 'team:submit_answer', { question_id: qid, selected_option: owlsPick, response_time_ms: 100 });
        await revealed;
        await h.waitFor(() => db.state.eventState[0].status === 'question_revealed', 'state to be revealed');
    };

    let shown = next(bears.sock, 'question:show');
    hostSock.emit('host:start_event', { event_id: 1 });
    await shown;

    // Not while a question is still open.
    const err = next(hostSock, 'error');
    hostSock.emit('host:next_question', { event_id: 1 });
    assert.equal((await err).code, 'invalid_state');

    await answerBoth(11, 'B', 'B'); // both right: 10 each

    shown = next(bears.sock, 'question:show');
    hostSock.emit('host:next_question', { event_id: 1 });
    const second = await shown;
    assert.equal(second.question_id, 12);
    assert.equal(second.question_number, 2);

    await answerBoth(12, 'C', 'A'); // hard question: 20 for the bears only

    const ended = next(owls.sock, 'game:ended');
    hostSock.emit('host:next_question', { event_id: 1 }); // no third question
    assert.deepEqual(await ended, {
        final_scores: [
            { team_id: bears.team_id, team_name: 'Quizzly Bears', points: 30 },
            { team_id: owls.team_id, team_name: 'Night Owls', points: 10 },
        ],
        winner_team_id: bears.team_id,
        tied_team_ids: [],
    });
    assert.equal(db.state.events[0].status, 'completed');
    assert.equal(db.state.eventState[0].status, 'ended');
});

test('host:end_event reports a tie instead of a winner', TEST_OPTS, async (t) => {
    const h = await start(t);
    const hostSock = await h.host(1);
    const bears = await h.team(1, 'Quizzly Bears');
    const owls = await h.team(1, 'Night Owls');

    const result = await end(hostSock, 1);
    assert.equal(result.winner_team_id, null);
    assert.deepEqual(result.tied_team_ids, [bears.team_id, owls.team_id]);
});

// ---------------------------------------------------------------------
//  Snapshot recovery
// ---------------------------------------------------------------------

test('team:rejoin gives a reconnecting team the question in play, the time left and the scores', TEST_OPTS, async (t) => {
    const h = await start(t);
    const hostSock = await h.host(1);
    const bears = await h.team(1, 'Quizzly Bears');
    const owls = await h.team(1, 'Night Owls');

    // Before the game starts there is no state row: the lobby.
    const lobby = await ask(bears.sock, 'team:rejoin', {});
    assert.equal(lobby.status, 'lobby');
    assert.equal(lobby.current_question, null);
    assert.equal(lobby.current_question_index, -1);

    const shown = next(owls.sock, 'question:show');
    hostSock.emit('host:start_event', { event_id: 1 });
    await shown;
    await ask(owls.sock, 'team:submit_answer', { question_id: 11, selected_option: 'B', response_time_ms: 100 });

    // The bears' tablet drops off the network and comes back with its token.
    bears.sock.disconnect();
    db.state.eventState[0].question_started_at = new Date(Date.now() - 2000);
    const back = await h.connected(h.open('/player', { session_token: bears.session_token }));
    const snap = await ask(back, 'team:rejoin', {});

    assert.equal(snap.team_id, bears.team_id);
    assert.equal(snap.event_id, 1);
    assert.equal(snap.status, 'question_active');
    assert.equal(snap.current_question_index, 0);
    assert.deepEqual(snap.current_question, {
        question_id: 11,
        question_text: 'Question 11?',
        options: { A: 'a', B: 'b', C: 'c', D: 'd' },
        difficulty: 'easy',
        time_limit_seconds: 5,
        question_number: 1,
    });
    assert.ok(snap.seconds_remaining === 2 || snap.seconds_remaining === 3, `about 3 s left, got ${snap.seconds_remaining}`);
    assert.deepEqual(snap.scores, [
        { team_id: owls.team_id, team_name: 'Night Owls', points: 10 },
        { team_id: bears.team_id, team_name: 'Quizzly Bears', points: 0 },
    ]);
    assert.ok(!JSON.stringify(snap).includes('correct'));

    // The recovered socket is back in the game: it can answer and hears broadcasts.
    const revealed = next(back, 'question:revealed');
    const reply = await ask(back, 'team:submit_answer', { question_id: 11, selected_option: 'B', response_time_ms: 1500 });
    assert.equal(reply.accepted, true);
    assert.equal((await revealed).correct_option, 'B');

    await end(hostSock, 1);
});

test('the REST snapshot rebuilds a late display, and holds the answer back until the reveal', TEST_OPTS, async (t) => {
    const h = await start(t);
    const hostSock = await h.host(1);
    const bears = await h.team(1, 'Quizzly Bears');

    assert.equal((await h.snapshot(999)).status, 404);
    const before = (await h.snapshot(1)).body;
    assert.equal(before.current_question, null);
    assert.deepEqual(before.scores, [{ team_id: bears.team_id, team_name: 'Quizzly Bears', points: 0 }]);

    const shown = next(bears.sock, 'question:show');
    hostSock.emit('host:start_event', { event_id: 1 });
    await shown;
    assert.equal((await ask(bears.sock, 'team:use_lifeline', {})).accepted, true);

    const during = (await h.snapshot(1)).body;
    assert.equal(during.event.status, 'live');
    assert.equal(during.current_question.question_id, 11);
    assert.equal(during.current_question.state, 'active');
    assert.equal(during.current_question.total_questions, 2);
    assert.equal(during.correct_option, null);
    assert.ok(!JSON.stringify(during).includes('correct_answer'));
    assert.deepEqual(during.lifelines_used, [{ team_id: bears.team_id, team_name: 'Quizzly Bears' }]);

    const revealed = next(hostSock, 'question:revealed');
    await ask(bears.sock, 'team:submit_answer', { question_id: 11, selected_option: 'B', response_time_ms: 100 });
    await revealed;
    await h.waitFor(() => db.state.eventState[0].status === 'question_revealed', 'state to be revealed');

    const after = (await h.snapshot(1)).body;
    assert.equal(after.current_question.state, 'revealed');
    assert.equal(after.correct_option, 'B');
    assert.deepEqual(after.scores, [{ team_id: bears.team_id, team_name: 'Quizzly Bears', points: 10 }]);

    await end(hostSock, 1);
});

test('a team gets one lifeline, announced to the room', TEST_OPTS, async (t) => {
    const h = await start(t);
    const tv = await h.display(1);
    const bears = await h.team(1, 'Quizzly Bears');

    const announced = next(tv, 'lifeline:used');
    assert.deepEqual(await ask(bears.sock, 'team:use_lifeline', {}), { accepted: true });
    assert.deepEqual(await announced, { team_id: bears.team_id, team_name: 'Quizzly Bears' });

    const again = await ask(bears.sock, 'team:use_lifeline', {});
    assert.equal(again.error.code, 'lifeline_already_used');
});

test('/display needs no login but only joins events that exist', TEST_OPTS, async (t) => {
    const h = await start(t);
    const tv = await h.connected(h.open('/display'));
    let err = next(tv, 'error');
    tv.emit('display:subscribe', { event_id: 999 });
    assert.equal((await err).code, 'event_not_found');
    err = next(tv, 'error');
    tv.emit('display:subscribe', null);
    assert.equal((await err).code, 'invalid_input');
});
