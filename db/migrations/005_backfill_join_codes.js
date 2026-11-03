#!/usr/bin/env node
// ============================================================
// D.A.T.I. — Migration 005 — backfill_join_codes (UP)
// Phase 2 follow-up. One-time backfill to populate join_code on
// events that were published or flipped to live BEFORE Phase 2 existed
// (the runtime PATCH handler only generates a code on transitions,
// so an idempotent re-save of an already-published event does NOT
// get a code — leaving pre-Phase-2 rows stuck at NULL).
//
// Scope: events WHERE status IN ('published', 'live') AND join_code IS NULL.
// Draft / completed / cancelled events are not touched.
//
// Alphabet + length + collision-retry match the runtime handler in
// server/routes/events.js — kept as a small duplicated constant here
// instead of importing, so this script stays standalone and doesn't
// need the full server module graph to execute.
//
// Safety:
//   * The UPDATE uses `WHERE id = ? AND join_code IS NULL` so a race
//     with the runtime handler (e.g. admin publishes a draft while
//     this script is running) cannot overwrite a code the handler
//     just set. affectedRows == 0 in that case → skip.
//   * Each per-row attempt is wrapped in a transaction so a crash
//     mid-loop leaves the DB consistent.
//   * Idempotent: a second run finds zero matching rows and exits
//     clean.
//
// Run:
//   node db/migrations/005_backfill_join_codes.js
// ============================================================

const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const mysql = require('mysql2/promise');

const JOIN_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generateJoinCode() {
    let out = '';
    for (let i = 0; i < 6; i++) {
        out += JOIN_CODE_ALPHABET[crypto.randomInt(JOIN_CODE_ALPHABET.length)];
    }
    return out;
}

async function main() {
    const pool = await mysql.createPool({
        host:     process.env.DB_HOST || 'localhost',
        user:     process.env.DB_USER || 'dati',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'dati_trivia',
        port:     process.env.DB_PORT || 3306,
        connectionLimit: 2,
    });

    let updated = 0, failed = 0, skipped = 0;
    try {
        const [rows] = await pool.query(
            `SELECT id, title, status FROM events
              WHERE status IN ('published', 'live') AND join_code IS NULL
              ORDER BY id`
        );
        if (rows.length === 0) {
            console.log('No events need backfill. All published/live events already have join codes.');
            return 0;
        }
        console.log(`Backfilling ${rows.length} event(s)...\n`);

        for (const ev of rows) {
            const conn = await pool.getConnection();
            let assigned = false;
            try {
                await conn.beginTransaction();
                for (let attempt = 0; attempt < 5 && !assigned; attempt++) {
                    const code = generateJoinCode();
                    try {
                        const [result] = await conn.query(
                            'UPDATE events SET join_code = ? WHERE id = ? AND join_code IS NULL',
                            [code, ev.id]
                        );
                        if (result.affectedRows === 1) {
                            console.log(`  id=${ev.id} "${ev.title}" (${ev.status}) → ${code}`);
                            assigned = true;
                        } else {
                            // Row changed between our SELECT and UPDATE. Skip safely.
                            console.log(`  id=${ev.id} "${ev.title}" — SKIPPED (row already had code by the time we updated)`);
                            skipped++;
                            break;
                        }
                    } catch (err) {
                        if (err.code === 'ER_DUP_ENTRY') {
                            console.log(`  id=${ev.id} collision on ${code}, retry ${attempt + 1}/5`);
                            continue;
                        }
                        throw err;
                    }
                }
                if (assigned) await conn.commit();
                else await conn.rollback();
                if (!assigned && skipped === 0) {
                    console.error(`  id=${ev.id} FAILED — exhausted 5 retries on collision`);
                    failed++;
                }
                if (assigned) updated++;
            } catch (err) {
                try { await conn.rollback(); } catch (_) {}
                console.error(`  id=${ev.id} ERROR:`, err.code || err.message);
                failed++;
            } finally {
                conn.release();
            }
        }
        console.log(`\nDone. updated=${updated} skipped=${skipped} failed=${failed}`);
        return failed === 0 ? 0 : 1;
    } finally {
        await pool.end();
    }
}

main()
    .then(code => process.exit(code || 0))
    .catch(err => { console.error('FATAL:', err); process.exit(2); });
