-- ============================================================
-- D.A.T.I. — Migration 001 — teams
-- Phase 1: Multiplayer Core
-- Adds the `teams` table for tracking team registrations per event.
-- Depends on: events(id)
-- ============================================================

USE dati_trivia;

CREATE TABLE teams (
    id             INT AUTO_INCREMENT PRIMARY KEY,
    event_id       INT           NOT NULL,
    team_name      VARCHAR(100)  NOT NULL,
    session_token  VARCHAR(64)   NOT NULL,
    member_count   INT           NOT NULL DEFAULT 1,
    lifeline_used  TINYINT(1)    NOT NULL DEFAULT 0,
    joined_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_team_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
    UNIQUE KEY uq_team_session_token (session_token),
    UNIQUE KEY uq_team_event_name    (event_id, team_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
