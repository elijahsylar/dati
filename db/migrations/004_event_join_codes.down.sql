-- ============================================================
-- D.A.T.I. — Rollback for Migration 004 — event_join_codes
-- Removes the join_code column from events and its unique index.
-- Safe to run independently. Historical join codes are lost if you
-- roll back after events have been published — not recoverable.
-- ============================================================

USE dati_trivia;

ALTER TABLE events
    DROP INDEX uq_event_join_code,
    DROP COLUMN join_code;
