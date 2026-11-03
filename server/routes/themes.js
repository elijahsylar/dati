const express = require('express');
const pool = require('../db');
const auth = require('../middleware/auth');
const router = express.Router();

// GET /api/themes — list all themes
router.get('/', async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT t.*, COUNT(q.id) AS question_count
             FROM themes t
             LEFT JOIN questions q ON q.theme_id = t.id AND q.is_active = 1
             GROUP BY t.id
             ORDER BY t.name`
        );
        res.json(rows);
    } catch (err) {
        console.error('Get themes error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// GET /api/themes/:id — single theme with questions
router.get('/:id', async (req, res) => {
    try {
        const [themes] = await pool.query('SELECT * FROM themes WHERE id = ?', [req.params.id]);
        if (themes.length === 0) return res.status(404).json({ error: 'Theme not found' });

        const [questions] = await pool.query(
            'SELECT * FROM questions WHERE theme_id = ? AND is_active = 1 ORDER BY difficulty, id',
            [req.params.id]
        );

        res.json({ ...themes[0], questions });
    } catch (err) {
        console.error('Get theme error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /api/themes — create theme
router.post('/', auth, async (req, res) => {
    try {
        const { name, description } = req.body;
        if (!name) return res.status(400).json({ error: 'Theme name is required' });

        const [result] = await pool.query(
            'INSERT INTO themes (name, description) VALUES (?, ?)',
            [name, description || null]
        );

        const [theme] = await pool.query('SELECT * FROM themes WHERE id = ?', [result.insertId]);
        res.status(201).json(theme[0]);
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: 'Theme name already exists' });
        }
        console.error('Create theme error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// PUT /api/themes/:id — update theme
router.put('/:id', auth, async (req, res) => {
    try {
        const { name, description, is_active } = req.body;
        const fields = [];
        const values = [];

        if (name !== undefined)        { fields.push('name = ?');        values.push(name); }
        if (description !== undefined)  { fields.push('description = ?'); values.push(description); }
        if (is_active !== undefined)    { fields.push('is_active = ?');   values.push(is_active); }

        if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });

        values.push(req.params.id);
        await pool.query(`UPDATE themes SET ${fields.join(', ')} WHERE id = ?`, values);

        const [theme] = await pool.query('SELECT * FROM themes WHERE id = ?', [req.params.id]);
        res.json(theme[0]);
    } catch (err) {
        console.error('Update theme error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// DELETE /api/themes/:id — soft delete
router.delete('/:id', auth, async (req, res) => {
    try {
        await pool.query('UPDATE themes SET is_active = 0 WHERE id = ?', [req.params.id]);
        res.json({ message: 'Theme deactivated' });
    } catch (err) {
        console.error('Delete theme error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
