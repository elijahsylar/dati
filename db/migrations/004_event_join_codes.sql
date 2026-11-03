-- ============================================================
-- D.A.T.I. — Migration 004 — event_join_codes
-- Phase 2: Player Join Flow
-- Adds a short human-enterable join code to events.
--   * Populated when an event transitions draft -> published.
--   * Cleared when an event transitions published -> draft.
--   * Left as-is for live/completed/cancelled (historical).
-- Storage is canonical 6-char uppercase (alphabet excludes 0/O/1/I/L).
-- UI formats as XXX-XXX for display; VARCHAR(8) is safety margin.
-- Depends on: events(id) (existing table — schema unmodified beyond
-- this one additive column).
-- ============================================================

USE dati_trivia;

ALTER TABLE events
    ADD COLUMN join_code VARCHAR(8) NULL AFTER status,
    ADD UNIQUE KEY uq_event_join_code (join_code);
