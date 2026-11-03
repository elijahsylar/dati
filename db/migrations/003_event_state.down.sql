-- ============================================================
-- D.A.T.I. — Rollback for Migration 003 — event_state
-- Safe to run independently. Does not touch events or questions.
-- ============================================================

USE dati_trivia;

DROP TABLE IF EXISTS event_state;
