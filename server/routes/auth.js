const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
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

// POST /api/auth/setup — first-run password setup. Only sets a password
// that is still the seeded placeholder, so it cannot reset a real one.
router.post('/setup', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password required' });
        }

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
