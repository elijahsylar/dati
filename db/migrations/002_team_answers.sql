-- ============================================================
-- D.A.T.I. — Migration 002 — team_answers
-- Phase 1: Multiplayer Core
-- One row per (team, question). `selected_option` NULL == timeout.
-- Depends on: teams(id), questions(id)
-- ============================================================

USE dati_trivia;

CREATE TABLE team_answers (
    id                INT AUTO_INCREMENT PRIMARY KEY,
    team_id           INT           NOT NULL,
    question_id       INT           NOT NULL,
    selected_option   ENUM('A','B','C','D') NULL,
    response_time_ms  INT           NULL,
    points_earned     INT           NOT NULL DEFAULT 0,
    submitted_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_team_answer_team     FOREIGN KEY (team_id)     REFERENCES teams(id)     ON DELETE CASCADE,
    CONSTRAINT fk_team_answer_question FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE RESTRICT,
    UNIQUE KEY uq_team_answer (team_id, question_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
