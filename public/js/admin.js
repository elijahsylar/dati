// ============================================================
// D.A.T.I. Admin Panel — Client JS
// ============================================================

const API = '';
let token = localStorage.getItem('dati_token') || null;
let currentUser = JSON.parse(localStorage.getItem('dati_user') || 'null');
let themes = [];
let questions = [];
let events = [];

// ---- API HELPERS ----
async function api(endpoint, opts = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`${API}${endpoint}`, { ...opts, headers });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
}

function toast(msg, type = '') {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = `toast show ${type}`;
    setTimeout(() => el.className = 'toast', 3000);
}

// ---- AUTH ----
async function login(e) {
    e.preventDefault();
    const username = document.getElementById('login-user').value;
    const password = document.getElementById('login-pass').value;
    try {
        const data = await api('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({ username, password })
        });
        token = data.token;
        currentUser = data.user;
        localStorage.setItem('dati_token', token);
        localStorage.setItem('dati_user', JSON.stringify(currentUser));
        showApp();
    } catch (err) {
        document.getElementById('login-error').textContent = err.message;
    }
}

function logout() {
    token = null;
    currentUser = null;
    localStorage.removeItem('dati_token');
    localStorage.removeItem('dati_user');
    showLogin();
}

function showLogin() {
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('app-screen').style.display = 'none';
}

function showApp() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app-screen').style.display = 'block';
    document.getElementById('user-display').textContent = currentUser.display_name;
    loadDashboard();
}

// ---- TABS ----
function switchTab(tab) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
    document.getElementById(`page-${tab}`).classList.add('active');

    if (tab === 'dashboard') loadDashboard();
    if (tab === 'themes')    loadThemes();
    if (tab === 'questions') loadQuestions();
    if (tab === 'events')    loadEvents();
}

// ---- DASHBOARD ----
async function loadDashboard() {
    try {
        [themes, questions, events] = await Promise.all([
            api('/api/themes'),
            api('/api/questions'),
            api('/api/events')
        ]);
        document.getElementById('stat-themes').textContent = themes.length;
        document.getElementById('stat-questions').textContent = questions.length;
        document.getElementById('stat-events').textContent = events.length;
        document.getElementById('stat-upcoming').textContent =
            events.filter(e => e.status === 'published' || e.status === 'draft').length;
    } catch (err) {
        toast('Failed to load dashboard', 'error');
    }
}

// ---- THEMES ----
async function loadThemes() {
    try {
        themes = await api('/api/themes');
        const tbody = document.getElementById('themes-body');
        tbody.innerHTML = themes.map(t => `
            <tr>
                <td><strong>${t.name}</strong></td>
                <td>${t.description || '—'}</td>
                <td>${t.question_count}</td>
                <td>${t.is_active ? '✅' : '❌'}</td>
                <td class="actions">
                    <button class="btn btn-sm btn-outline" onclick="editTheme(${t.id})">Edit</button>
                    <button class="btn btn-sm btn-danger" onclick="deleteTheme(${t.id}, '${t.name}')">Delete</button>
                </td>
            </tr>
        `).join('');
    } catch (err) {
        toast('Failed to load themes', 'error');
    }
}

function openThemeModal(theme = null) {
    document.getElementById('theme-modal-title').textContent = theme ? 'Edit Theme' : 'New Theme';
    document.getElementById('theme-id').value = theme ? theme.id : '';
    document.getElementById('theme-name').value = theme ? theme.name : '';
    document.getElementById('theme-desc').value = theme ? (theme.description || '') : '';
    document.getElementById('theme-modal').classList.add('active');
}

async function editTheme(id) {
    const theme = themes.find(t => t.id === id);
    openThemeModal(theme);
}

async function saveTheme(e) {
    e.preventDefault();
    const id = document.getElementById('theme-id').value;
    const body = {
        name: document.getElementById('theme-name').value,
        description: document.getElementById('theme-desc').value
    };
    try {
        if (id) {
            await api(`/api/themes/${id}`, { method: 'PUT', body: JSON.stringify(body) });
            toast('Theme updated', 'success');
        } else {
            await api('/api/themes', { method: 'POST', body: JSON.stringify(body) });
            toast('Theme created', 'success');
        }
        closeModal('theme-modal');
        loadThemes();
    } catch (err) {
        toast(err.message, 'error');
    }
}

async function deleteTheme(id, name) {
    if (!confirm(`Deactivate theme "${name}"?`)) return;
    try {
        await api(`/api/themes/${id}`, { method: 'DELETE' });
        toast('Theme deactivated', 'success');
        loadThemes();
    } catch (err) {
        toast(err.message, 'error');
    }
}

// ---- QUESTIONS ----
async function loadQuestions() {
    try {
        questions = await api('/api/questions');
        if (themes.length === 0) themes = await api('/api/themes');

        // Populate theme filter
        const filter = document.getElementById('question-theme-filter');
        const currentVal = filter.value;
        filter.innerHTML = '<option value="">All Themes</option>' +
            themes.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
        filter.value = currentVal;

        let filtered = questions;
        if (filter.value) filtered = questions.filter(q => q.theme_id == filter.value);

        const tbody = document.getElementById('questions-body');
        tbody.innerHTML = filtered.map(q => `
            <tr>
                <td>${q.theme_name}</td>
                <td>${q.question_text.length > 80 ? q.question_text.slice(0, 80) + '…' : q.question_text}</td>
                <td><span class="badge badge-${q.difficulty}">${q.difficulty}</span></td>
                <td><strong>${q.correct_answer}</strong></td>
                <td class="actions">
                    <button class="btn btn-sm btn-outline" onclick="editQuestion(${q.id})">Edit</button>
                    <button class="btn btn-sm btn-danger" onclick="deleteQuestion(${q.id})">Delete</button>
                </td>
            </tr>
        `).join('');
    } catch (err) {
        toast('Failed to load questions', 'error');
    }
}

function openQuestionModal(q = null) {
    document.getElementById('q-modal-title').textContent = q ? 'Edit Question' : 'New Question';
    document.getElementById('q-id').value = q ? q.id : '';

    const sel = document.getElementById('q-theme');
    sel.innerHTML = themes.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
    if (q) sel.value = q.theme_id;

    document.getElementById('q-text').value = q ? q.question_text : '';
    document.getElementById('q-a').value = q ? q.option_a : '';
    document.getElementById('q-b').value = q ? q.option_b : '';
    document.getElementById('q-c').value = q ? q.option_c : '';
    document.getElementById('q-d').value = q ? q.option_d : '';
    document.getElementById('q-correct').value = q ? q.correct_answer : 'A';
    document.getElementById('q-difficulty').value = q ? q.difficulty : 'medium';
    document.getElementById('question-modal').classList.add('active');
}

async function editQuestion(id) {
    const q = questions.find(x => x.id === id);
    openQuestionModal(q);
}

async function saveQuestion(e) {
    e.preventDefault();
    const id = document.getElementById('q-id').value;
    const body = {
        theme_id: document.getElementById('q-theme').value,
        question_text: document.getElementById('q-text').value,
        option_a: document.getElementById('q-a').value,
        option_b: document.getElementById('q-b').value,
        option_c: document.getElementById('q-c').value,
        option_d: document.getElementById('q-d').value,
        correct_answer: document.getElementById('q-correct').value,
        difficulty: document.getElementById('q-difficulty').value
    };
    try {
        if (id) {
            await api(`/api/questions/${id}`, { method: 'PUT', body: JSON.stringify(body) });
            toast('Question updated', 'success');
        } else {
            await api('/api/questions', { method: 'POST', body: JSON.stringify(body) });
            toast('Question created', 'success');
        }
        closeModal('question-modal');
        loadQuestions();
    } catch (err) {
        toast(err.message, 'error');
    }
}

async function deleteQuestion(id) {
    if (!confirm('Deactivate this question?')) return;
    try {
        await api(`/api/questions/${id}`, { method: 'DELETE' });
        toast('Question deactivated', 'success');
        loadQuestions();
    } catch (err) {
        toast(err.message, 'error');
    }
}

// ---- EVENTS ----
async function loadEvents() {
    try {
        events = await api('/api/events');
        if (themes.length === 0) themes = await api('/api/themes');

        const tbody = document.getElementById('events-body');
        tbody.innerHTML = events.map(e => `
            <tr>
                <td><strong>${e.title}</strong></td>
                <td>${e.theme_name}</td>
                <td>${new Date(e.event_date).toLocaleDateString()}</td>
                <td>${e.start_time.slice(0, 5)}</td>
                <td>${e.max_teams} teams / ${e.max_players_per_team} per</td>
                <td><span class="badge badge-${e.status}">${e.status}</span></td>
                <td class="actions">${eventActionsFor(e)}</td>
            </tr>
        `).join('');
    } catch (err) {
        toast('Failed to load events', 'error');
    }
}

// Render the Actions cell based on event.status. Live/completed/cancelled
// events hide status buttons that don't apply, per the Phase 1 lifecycle:
// draft↔published transitions are admin; live/completed are socket-owned.
// QR button shows only on published/live events that have a join_code.
function eventActionsFor(e) {
    const t = e.title.replace(/'/g, "\\'");
    const demoLink = `<a href="/play.html?theme_id=${e.theme_id}&title=${encodeURIComponent(e.title)}" target="_blank" class="btn btn-sm btn-gold">▶ Demo</a>`;
    const demoDisabled = `<button class="btn btn-sm btn-gold" disabled>▶ Demo</button>`;
    const editBtn = `<button class="btn btn-sm btn-outline" onclick="editEvent(${e.id})">Edit</button>`;
    const editDisabled = `<button class="btn btn-sm btn-outline" disabled>Edit</button>`;
    const cancelBtn = `<button class="btn btn-sm btn-danger" onclick="cancelEvent(${e.id}, '${t}')">Cancel</button>`;
    const qrBtn = (e.join_code && (e.status === 'published' || e.status === 'live'))
        ? `<button class="btn btn-sm btn-primary" onclick="openQrModal(${e.id}, '${e.join_code}')">QR</button>`
        : '';
    switch (e.status) {
        case 'draft':
            return `<button class="btn btn-sm btn-primary" onclick="publishEvent(${e.id})">Publish</button>${editBtn}${demoLink}${cancelBtn}`;
        case 'published':
            return `<button class="btn btn-sm btn-outline" onclick="unpublishEvent(${e.id}, '${t}')">Unpublish</button>${editBtn}${qrBtn}${demoLink}${cancelBtn}`;
        case 'live':
            return `${editDisabled}${qrBtn}${demoDisabled}`;
        case 'completed':
            return `<button class="btn btn-sm btn-outline" onclick="resetEventToDraft(${e.id}, '${t}')">Reset to Draft</button>${demoLink}`;
        case 'cancelled':
            return `<button class="btn btn-sm btn-outline" onclick="resetEventToDraft(${e.id}, '${t}')">Reset to Draft</button>`;
        default:
            return '';
    }
}

// ---- QR code modal ----
let qrCurrentEventId = null;
let qrObjectUrl = null;

async function openQrModal(eventId, joinCode) {
    qrCurrentEventId = eventId;
    const displayCode = joinCode.slice(0, 3) + '-' + joinCode.slice(3);
    document.getElementById('qr-code-display').textContent = displayCode;
    try {
        const res = await fetch(`/api/events/${eventId}/qr-code.png`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error('Failed to load QR image');
        const blob = await res.blob();
        if (qrObjectUrl) URL.revokeObjectURL(qrObjectUrl);
        qrObjectUrl = URL.createObjectURL(blob);
        document.getElementById('qr-img').src = qrObjectUrl;
        document.getElementById('qr-modal').classList.add('active');
    } catch (err) {
        toast(err.message, 'error');
    }
}

function downloadQr() {
    if (!qrObjectUrl) return;
    const a = document.createElement('a');
    a.href = qrObjectUrl;
    a.download = `dati-qr-event-${qrCurrentEventId}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

async function openPrintCard() {
    if (!qrCurrentEventId) return;
    try {
        const res = await fetch(`/api/events/${qrCurrentEventId}/print-card.html`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error('Failed to load print card');
        const html = await res.text();
        const w = window.open('', '_blank');
        if (!w) { toast('Pop-up blocked — allow pop-ups to print', 'error'); return; }
        w.document.open();
        w.document.write(html);
        w.document.close();
    } catch (err) {
        toast(err.message, 'error');
    }
}

async function patchEventStatus(id, status) {
    return api(`/api/events/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
    });
}

async function publishEvent(id) {
    try {
        await patchEventStatus(id, 'published');
        toast('Event published', 'success');
        loadEvents();
    } catch (err) {
        toast(err.message, 'error');
    }
}

async function unpublishEvent(id, title) {
    if (!confirm(`Unpublish "${title}"? Hosts won't be able to pick it until republished.`)) return;
    try {
        await patchEventStatus(id, 'draft');
        toast('Event unpublished', 'success');
        loadEvents();
    } catch (err) {
        toast(err.message, 'error');
    }
}

async function resetEventToDraft(id, title) {
    if (!confirm(`Reset "${title}" to draft? This lets you re-host it but does NOT clear past team scores or answers.`)) return;
    try {
        await patchEventStatus(id, 'draft');
        toast('Event reset to draft', 'success');
        loadEvents();
    } catch (err) {
        toast(err.message, 'error');
    }
}

function openEventModal(ev = null) {
    document.getElementById('ev-modal-title').textContent = ev ? 'Edit Event' : 'New Event';
    document.getElementById('ev-id').value = ev ? ev.id : '';

    const sel = document.getElementById('ev-theme');
    sel.innerHTML = themes.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
    if (ev) sel.value = ev.theme_id;

    document.getElementById('ev-title').value = ev ? ev.title : '';
    document.getElementById('ev-date').value = ev ? ev.event_date.slice(0, 10) : '';
    document.getElementById('ev-time').value = ev ? ev.start_time.slice(0, 5) : '19:00';
    document.getElementById('ev-teams').value = ev ? ev.max_teams : 30;
    document.getElementById('ev-players').value = ev ? ev.max_players_per_team : 5;
    document.getElementById('ev-questions').value = ev ? ev.question_count : 10;
    document.getElementById('ev-timelimit').value = ev ? ev.time_limit_seconds : 30;
    document.getElementById('event-modal').classList.add('active');
}

async function editEvent(id) {
    const ev = events.find(e => e.id === id);
    openEventModal(ev);
}

async function saveEvent(e) {
    e.preventDefault();
    const id = document.getElementById('ev-id').value;
    const body = {
        theme_id: document.getElementById('ev-theme').value,
        title: document.getElementById('ev-title').value,
        event_date: document.getElementById('ev-date').value,
        start_time: document.getElementById('ev-time').value + ':00',
        max_teams: parseInt(document.getElementById('ev-teams').value),
        max_players_per_team: parseInt(document.getElementById('ev-players').value),
        question_count: parseInt(document.getElementById('ev-questions').value),
        time_limit_seconds: parseInt(document.getElementById('ev-timelimit').value)
    };
    try {
        if (id) {
            await api(`/api/events/${id}`, { method: 'PUT', body: JSON.stringify(body) });
            toast('Event updated', 'success');
        } else {
            await api('/api/events', { method: 'POST', body: JSON.stringify(body) });
            toast('Event created', 'success');
        }
        closeModal('event-modal');
        loadEvents();
    } catch (err) {
        toast(err.message, 'error');
    }
}

async function cancelEvent(id, title) {
    if (!confirm(`Cancel event "${title}"?`)) return;
    try {
        await patchEventStatus(id, 'cancelled');
        toast('Event cancelled', 'success');
        loadEvents();
    } catch (err) {
        toast(err.message, 'error');
    }
}

// ---- MODAL HELPERS ----
function closeModal(id) {
    // QR modal cleanup: revoke the object URL so the browser releases the blob.
    if (id === 'qr-modal' && qrObjectUrl) {
        URL.revokeObjectURL(qrObjectUrl);
        qrObjectUrl = null;
    }
    document.getElementById(id).classList.remove('active');
}

// ---- INIT ----
document.addEventListener('DOMContentLoaded', () => {
    if (token && currentUser) {
        showApp();
    } else {
        showLogin();
    }
});
