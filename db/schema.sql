-- Upskill schema (SQLite / libSQL).
-- Derived values (percent complete, earned skills, at-risk, active days,
-- eligibility) are computed in lib/rules.ts and never stored.

PRAGMA foreign_keys = ON;

DROP TABLE IF EXISTS coach_nudges;
DROP TABLE IF EXISTS activity_events;
DROP TABLE IF EXISTS enrollments;
DROP TABLE IF EXISTS learner_center_memberships;
DROP TABLE IF EXISTS coaches;
DROP TABLE IF EXISTS center_courses;
DROP TABLE IF EXISTS centers;
DROP TABLE IF EXISTS learner_goals;
DROP TABLE IF EXISTS learners;
DROP TABLE IF EXISTS course_prerequisites;
DROP TABLE IF EXISTS course_skills;
DROP TABLE IF EXISTS courses;
DROP TABLE IF EXISTS skills;

-- ---------------------------------------------------------------------------
-- Shared across all centers: the catalog and the learner identity.
-- ---------------------------------------------------------------------------

CREATE TABLE skills (
  id   TEXT PRIMARY KEY,               -- slug, e.g. 'react'
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE courses (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  total_lessons INTEGER NOT NULL CHECK (total_lessons > 0)
);

CREATE TABLE course_skills (
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  skill_id  TEXT NOT NULL REFERENCES skills(id)  ON DELETE CASCADE,
  PRIMARY KEY (course_id, skill_id)
);

CREATE TABLE course_prerequisites (
  course_id       TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  prerequisite_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  PRIMARY KEY (course_id, prerequisite_id),
  CHECK (course_id <> prerequisite_id)
);

CREATE TABLE learners (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE learner_goals (
  learner_id TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  skill_id   TEXT NOT NULL REFERENCES skills(id),
  PRIMARY KEY (learner_id, skill_id)
);

-- ---------------------------------------------------------------------------
-- Per center: tenancy, staff, membership, and what each center offers.
-- ---------------------------------------------------------------------------

CREATE TABLE centers (
  id       TEXT PRIMARY KEY,
  name     TEXT NOT NULL UNIQUE,
  timezone TEXT NOT NULL                -- IANA zone used for "days" math
);

-- Which shared courses a center offers. Enrollment requires an offering.
CREATE TABLE center_courses (
  center_id TEXT NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  PRIMARY KEY (center_id, course_id)
);

CREATE TABLE coaches (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  center_id TEXT NOT NULL REFERENCES centers(id)
);
CREATE INDEX idx_coaches_center ON coaches(center_id);

-- A learner belongs to exactly one center at a time. Moving closes the
-- current row (ended_at) and opens a new one; history is kept.
CREATE TABLE learner_center_memberships (
  id         INTEGER PRIMARY KEY,
  learner_id TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  center_id  TEXT NOT NULL REFERENCES centers(id),
  started_at TEXT NOT NULL,
  ended_at   TEXT,
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);
CREATE UNIQUE INDEX uq_one_current_membership
  ON learner_center_memberships(learner_id) WHERE ended_at IS NULL;
CREATE INDEX idx_memberships_center
  ON learner_center_memberships(center_id) WHERE ended_at IS NULL;

-- ---------------------------------------------------------------------------
-- Learning records: owned by the learner, so they move with the learner.
-- ---------------------------------------------------------------------------

CREATE TABLE enrollments (
  id                INTEGER PRIMARY KEY,
  learner_id        TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  course_id         TEXT NOT NULL REFERENCES courses(id),
  center_id         TEXT NOT NULL REFERENCES centers(id),  -- where it was enrolled (audit / reporting)
  enrolled_at       TEXT NOT NULL,
  completed_lessons INTEGER NOT NULL DEFAULT 0 CHECK (completed_lessons >= 0),
  UNIQUE (learner_id, course_id)
);
CREATE INDEX idx_enrollments_course ON enrollments(course_id);

-- completed_lessons may not exceed the course's lesson count.
CREATE TRIGGER trg_enrollment_lessons_insert
BEFORE INSERT ON enrollments
WHEN NEW.completed_lessons > (SELECT total_lessons FROM courses WHERE id = NEW.course_id)
BEGIN
  SELECT RAISE(ABORT, 'completed_lessons exceeds total_lessons');
END;
CREATE TRIGGER trg_enrollment_lessons_update
BEFORE UPDATE OF completed_lessons ON enrollments
WHEN NEW.completed_lessons > (SELECT total_lessons FROM courses WHERE id = NEW.course_id)
BEGIN
  SELECT RAISE(ABORT, 'completed_lessons exceeds total_lessons');
END;

-- One row per learning session. "Last active" = MAX(occurred_at).
CREATE TABLE activity_events (
  id            INTEGER PRIMARY KEY,
  enrollment_id INTEGER NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  occurred_at   TEXT NOT NULL
);
CREATE INDEX idx_activity_enrollment_time ON activity_events(enrollment_id, occurred_at);

-- Add-on: coaches log when they reached out about a course, so the next
-- coach (or the same one tomorrow) doesn't nudge twice.
CREATE TABLE coach_nudges (
  id            INTEGER PRIMARY KEY,
  coach_id      TEXT NOT NULL REFERENCES coaches(id),
  enrollment_id INTEGER NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_nudges_enrollment ON coach_nudges(enrollment_id, created_at);
