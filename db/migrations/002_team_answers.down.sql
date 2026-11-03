-- ============================================================
-- D.A.T.I. — Rollback for Migration 002 — team_answers
-- Safe to run independently. Drop before dropping teams or questions
-- if you want to avoid cascade/restrict surprises.
-- ============================================================

USE dati_trivia;

DROP TABLE IF EXISTS team_answers;
