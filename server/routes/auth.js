const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const pool = require('../db');
const router = express.Router();

// POST /api/auth/login
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password required' });
        }

        const [rows] = await pool.query(
            'SELECT * FROM admin_users WHERE username = ? AND is_active = 1',
            [username]
        );

        if (rows.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const user = rows[0];
        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: '8h' }
        );

        res.json({
            token,
            user: { id: user.id, username: user.username, display_name: user.display_name, role: user.role }
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// A setup secret shorter than this counts as not set.
const MIN_SETUP_SECRET_LENGTH = 16;

// True when both are non-empty strings. An array or object must never
// reach a query: mysql2 would expand it into SQL of its own.
function hasCredentials(body) {
    const { username, password } = body || {};
    return typeof username === 'string' && username !== ''
        && typeof password === 'string' && password !== '';
}

// Constant-time comparison. Both sides are hashed first, so the lengths
// always match and the length of the secret is not leaked either.
function secretMatches(given, expected) {
    const a = crypto.createHash('sha256').update(String(given)).digest();
    const b = crypto.createHash('sha256').update(String(expected)).digest();
    return crypto.timingSafeEqual(a, b);
}

// POST /api/auth/setup — first-run password setup. Only sets a password
// that is still the seeded placeholder, so it cannot reset a real one.
// Needs the SETUP_SECRET from the environment in the X-Setup-Secret
// header. With no SETUP_SECRET, or one shorter than 16 characters, the
// route is off (404), never open.
router.post('/setup', async (req, res) => {
    try {
        const expected = process.env.SETUP_SECRET;
        if (!expected || expected.length < MIN_SETUP_SECRET_LENGTH) {
            return res.status(404).json({ error: 'Not found' });
        }

        const given = req.get('x-setup-secret');
        if (!given || !secretMatches(given, expected)) {
            return res.status(403).json({ error: 'Setup secret required' });
        }

        if (!hasCredentials(req.body)) {
            return res.status(400).json({ error: 'Username and password required' });
        }
        const { username, password } = req.body;

        // Once every seeded account has a real password there is nothing
        // left to set up, so the route answers as if it did not exist.
        const [pending] = await pool.query(
            "SELECT COUNT(*) AS n FROM admin_users WHERE password_hash LIKE '%placeholder%'"
        );
        if (Number(pending[0].n) === 0) return res.status(404).json({ error: 'Not found' });

        const hash = await bcrypt.hash(password, 10);
        const [result] = await pool.query(
            "UPDATE admin_users SET password_hash = ? WHERE username = ? AND password_hash LIKE '%placeholder%'",
            [hash, username]
        );

        if (result.affectedRows === 0) {
            return res.status(409).json({ error: 'Unknown user, or password already set' });
        }

        res.json({ message: `Password set for ${username}` });
    } catch (err) {
        console.error('Setup error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
