-- ============================================================
-- D.A.T.I. — Migration 003 — event_state
-- Phase 1: Multiplayer Core
-- 1:1 with events (event_id is PK and FK). Tracks live game state.
-- current_question_index: -1 = lobby, 0+ = in-progress.
-- Depends on: events(id), questions(id)
-- ============================================================

USE dati_trivia;

CREATE TABLE event_state (
    event_id                 INT            NOT NULL,
    current_question_index   INT            NOT NULL DEFAULT -1,
    current_question_id      INT            NULL,
    question_started_at      TIMESTAMP      NULL,
    status                   ENUM('lobby','question_active','question_locked','question_revealed','intermission','ended') NOT NULL DEFAULT 'lobby',
    updated_at               TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (event_id),
    CONSTRAINT fk_event_state_event    FOREIGN KEY (event_id)            REFERENCES events(id)    ON DELETE CASCADE,
    CONSTRAINT fk_event_state_question FOREIGN KEY (current_question_id) REFERENCES questions(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
