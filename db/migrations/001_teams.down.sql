-- ============================================================
-- D.A.T.I. — Rollback for Migration 001 — teams
-- WARNING: Run AFTER 002_team_answers.down.sql — team_answers has
-- ON DELETE CASCADE FK into teams, so dropping teams while team_answers
-- exists will succeed but wipe all answer rows. If that's not intended,
-- run 002 down first.
-- ============================================================

USE dati_trivia;

DROP TABLE IF EXISTS teams;
