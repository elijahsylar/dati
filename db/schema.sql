-- ============================================================
-- D.A.T.I. [Don't Ask The Internet] — Database Schema
-- MySQL 8.x
-- ============================================================

CREATE DATABASE IF NOT EXISTS dati_trivia;
USE dati_trivia;

-- ============================================================
-- THEMES
-- ============================================================
CREATE TABLE themes (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(100)  NOT NULL,
    description VARCHAR(500)  DEFAULT NULL,
    is_active   TINYINT(1)    NOT NULL DEFAULT 1,
    created_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_theme_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- QUESTIONS
-- ============================================================
CREATE TABLE questions (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    theme_id        INT            NOT NULL,
    question_text   VARCHAR(1000)  NOT NULL,
    option_a        VARCHAR(500)   NOT NULL,
    option_b        VARCHAR(500)   NOT NULL,
    option_c        VARCHAR(500)   NOT NULL,
    option_d        VARCHAR(500)   NOT NULL,
    correct_answer  ENUM('A','B','C','D') NOT NULL,
    difficulty      ENUM('easy','medium','hard') NOT NULL DEFAULT 'medium',
    is_active       TINYINT(1)     NOT NULL DEFAULT 1,
    created_at      TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_question_theme FOREIGN KEY (theme_id) REFERENCES themes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- EVENTS
-- ============================================================
CREATE TABLE events (
    id                  INT AUTO_INCREMENT PRIMARY KEY,
    theme_id            INT           NOT NULL,
    title               VARCHAR(200)  NOT NULL,
    event_date          DATE          NOT NULL,
    start_time          TIME          NOT NULL DEFAULT '19:00:00',
    max_teams           INT           NOT NULL DEFAULT 30,
    max_players_per_team INT          NOT NULL DEFAULT 5,
    question_count      INT           NOT NULL DEFAULT 10,
    time_limit_seconds  INT           NOT NULL DEFAULT 30,
    status              ENUM('draft','published','live','completed','cancelled') NOT NULL DEFAULT 'draft',
    created_at          TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_event_theme FOREIGN KEY (theme_id) REFERENCES themes(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- ADMIN USERS (host login)
-- ============================================================
CREATE TABLE admin_users (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    username        VARCHAR(50)   NOT NULL,
    password_hash   VARCHAR(255)  NOT NULL,
    display_name    VARCHAR(100)  NOT NULL,
    role            ENUM('admin','host') NOT NULL DEFAULT 'host',
    is_active       TINYINT(1)    NOT NULL DEFAULT 1,
    created_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_admin_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX idx_questions_theme   ON questions(theme_id);
CREATE INDEX idx_questions_active  ON questions(is_active);
CREATE INDEX idx_events_date       ON events(event_date);
CREATE INDEX idx_events_status     ON events(status);
CREATE INDEX idx_events_theme      ON events(theme_id);
