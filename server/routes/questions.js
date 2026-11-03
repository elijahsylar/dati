const express = require('express');
const pool = require('../db');
const auth = require('../middleware/auth');
const router = express.Router();

// GET /api/questions — list questions (optional ?theme_id= filter)
router.get('/', async (req, res) => {
    try {
        let query = `
            SELECT q.*, t.name AS theme_name
            FROM questions q
            JOIN themes t ON t.id = q.theme_id
            WHERE q.is_active = 1
        `;
        const params = [];

        if (req.query.theme_id) {
            query += ' AND q.theme_id = ?';
            params.push(req.query.theme_id);
        }
        if (req.query.difficulty) {
            query += ' AND q.difficulty = ?';
            params.push(req.query.difficulty);
        }

        query += ' ORDER BY q.theme_id, q.difficulty, q.id';

        const [rows] = await pool.query(query, params);
        res.json(rows);
    } catch (err) {
        console.error('Get questions error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// GET /api/questions/:id
router.get('/:id', async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT q.*, t.name AS theme_name
             FROM questions q
             JOIN themes t ON t.id = q.theme_id
             WHERE q.id = ?`,
            [req.params.id]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'Question not found' });
        res.json(rows[0]);
    } catch (err) {
        console.error('Get question error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /api/questions — create question
router.post('/', auth, async (req, res) => {
    try {
        const { theme_id, question_text, option_a, option_b, option_c, option_d, correct_answer, difficulty } = req.body;

        if (!theme_id || !question_text || !option_a || !option_b || !option_c || !option_d || !correct_answer) {
            return res.status(400).json({ error: 'All question fields are required' });
        }

        if (!['A', 'B', 'C', 'D'].includes(correct_answer.toUpperCase())) {
            return res.status(400).json({ error: 'correct_answer must be A, B, C, or D' });
        }

        const [result] = await pool.query(
            `INSERT INTO questions (theme_id, question_text, option_a, option_b, option_c, option_d, correct_answer, difficulty)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [theme_id, question_text, option_a, option_b, option_c, option_d, correct_answer.toUpperCase(), difficulty || 'medium']
        );

        const [question] = await pool.query('SELECT * FROM questions WHERE id = ?', [result.insertId]);
        res.status(201).json(question[0]);
    } catch (err) {
        console.error('Create question error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// PUT /api/questions/:id — update question
router.put('/:id', auth, async (req, res) => {
    try {
        const allowed = ['theme_id', 'question_text', 'option_a', 'option_b', 'option_c', 'option_d', 'correct_answer', 'difficulty', 'is_active'];
        const fields = [];
        const values = [];

        for (const key of allowed) {
            if (req.body[key] !== undefined) {
                fields.push(`${key} = ?`);
                values.push(key === 'correct_answer' ? req.body[key].toUpperCase() : req.body[key]);
            }
        }

        if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });

        values.push(req.params.id);
        await pool.query(`UPDATE questions SET ${fields.join(', ')} WHERE id = ?`, values);

        const [question] = await pool.query('SELECT * FROM questions WHERE id = ?', [req.params.id]);
        res.json(question[0]);
    } catch (err) {
        console.error('Update question error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// DELETE /api/questions/:id — soft delete
router.delete('/:id', auth, async (req, res) => {
    try {
        await pool.query('UPDATE questions SET is_active = 0 WHERE id = ?', [req.params.id]);
        res.json({ message: 'Question deactivated' });
    } catch (err) {
        console.error('Delete question error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
