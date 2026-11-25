-- Prepwise schema (SQLite). Safe to run repeatedly.
-- Timestamps are local time stored as 'YYYY-MM-DD HH:MM:SS'.

CREATE TABLE IF NOT EXISTS students (
    id              INTEGER PRIMARY KEY,
    name            TEXT NOT NULL,
    email           TEXT,
    exam_name       TEXT DEFAULT 'Final exam',
    exam_date       TEXT,
    daily_hours     REAL NOT NULL DEFAULT 3,
    study_start     TEXT NOT NULL DEFAULT '17:00:00',
    sleep_time      TEXT NOT NULL DEFAULT '23:00:00',
    created_at      TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS subjects (
    id          INTEGER PRIMARY KEY,
    student_id  INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    color       TEXT NOT NULL DEFAULT '#3D6BF5',
    UNIQUE (student_id, name)
);

CREATE TABLE IF NOT EXISTS topics (
    id              INTEGER PRIMARY KEY,
    student_id      INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    subject_id      INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
    title           TEXT NOT NULL,
    description     TEXT DEFAULT '',
    weightage       REAL NOT NULL DEFAULT 3,      -- 1..5 exam importance
    difficulty      REAL NOT NULL DEFAULT 2,      -- 1..3
    est_minutes     INTEGER NOT NULL DEFAULT 45,  -- time to learn from scratch
    mastery         REAL NOT NULL DEFAULT 0,      -- 0..100
    last_studied    TEXT,
    times_studied   INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    UNIQUE (student_id, title)
);

CREATE TABLE IF NOT EXISTS mastery_history (
    id          INTEGER PRIMARY KEY,
    topic_id    INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    mastery     REAL NOT NULL,
    source      TEXT NOT NULL DEFAULT 'manual',
    recorded_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- Uploaded study material (the RAG corpus)
CREATE TABLE IF NOT EXISTS documents (
    id          INTEGER PRIMARY KEY,
    student_id  INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    subject_id  INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
    title       TEXT NOT NULL,
    filename    TEXT,
    kind        TEXT NOT NULL DEFAULT 'text',
    size_bytes  INTEGER NOT NULL DEFAULT 0,
    content     TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS chunks (
    id          INTEGER PRIMARY KEY,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    student_id  INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    idx         INTEGER NOT NULL,
    heading     TEXT DEFAULT '',
    content     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS chunks_doc_idx ON chunks (document_id);

-- Full-text index over chunks (BM25 ranking, Porter stemming), kept in sync by triggers
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
    heading, content, content='chunks', content_rowid='id', tokenize='porter unicode61'
);
CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
    INSERT INTO chunks_fts (rowid, heading, content) VALUES (new.id, new.heading, new.content);
END;
CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
    INSERT INTO chunks_fts (chunks_fts, rowid, heading, content) VALUES ('delete', old.id, old.heading, old.content);
END;

-- Notion-style pages
CREATE TABLE IF NOT EXISTS notes (
    id          INTEGER PRIMARY KEY,
    student_id  INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    parent_id   INTEGER REFERENCES notes(id) ON DELETE CASCADE,
    subject_id  INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
    title       TEXT NOT NULL DEFAULT 'Untitled',
    icon        TEXT NOT NULL DEFAULT '',
    content     TEXT NOT NULL DEFAULT '',
    tags        TEXT NOT NULL DEFAULT '[]',           -- JSON array
    pinned      INTEGER NOT NULL DEFAULT 0,
    position    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS mindmaps (
    id          INTEGER PRIMARY KEY,
    student_id  INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL,
    title       TEXT NOT NULL,
    data        TEXT NOT NULL,                         -- JSON
    created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS roadmaps (
    id          INTEGER PRIMARY KEY,
    student_id  INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    mode        TEXT NOT NULL,                         -- 'standard' | 'crisis'
    exam_date   TEXT,
    summary     TEXT NOT NULL DEFAULT '{}',            -- JSON
    active      INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- Calendar: study blocks, revisions, breaks, reminders, exams
CREATE TABLE IF NOT EXISTS events (
    id              INTEGER PRIMARY KEY,
    student_id      INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    roadmap_id      INTEGER REFERENCES roadmaps(id) ON DELETE CASCADE,
    topic_id        INTEGER REFERENCES topics(id) ON DELETE SET NULL,
    title           TEXT NOT NULL,
    kind            TEXT NOT NULL DEFAULT 'study',     -- study|revise|practice|break|exam|reminder
    phase           TEXT DEFAULT '',
    start_at        TEXT NOT NULL,
    end_at          TEXT NOT NULL,
    remind_before   INTEGER NOT NULL DEFAULT 10,       -- minutes
    status          TEXT NOT NULL DEFAULT 'planned',   -- planned|done|skipped
    notes           TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS events_student_time_idx ON events (student_id, start_at);

CREATE TABLE IF NOT EXISTS chats (
    id          INTEGER PRIMARY KEY,
    student_id  INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    title       TEXT NOT NULL DEFAULT 'New chat',
    created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS messages (
    id          INTEGER PRIMARY KEY,
    chat_id     INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    role        TEXT NOT NULL,
    content     TEXT NOT NULL,
    meta        TEXT NOT NULL DEFAULT '{}',            -- JSON
    created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS study_sessions (
    id          INTEGER PRIMARY KEY,
    student_id  INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    topic_id    INTEGER REFERENCES topics(id) ON DELETE SET NULL,
    event_id    INTEGER REFERENCES events(id) ON DELETE SET NULL,
    minutes     INTEGER NOT NULL,
    kind        TEXT NOT NULL DEFAULT 'study',
    created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS quiz_attempts (
    id          INTEGER PRIMARY KEY,
    student_id  INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    topic_id    INTEGER REFERENCES topics(id) ON DELETE SET NULL,
    score       INTEGER NOT NULL,
    total       INTEGER NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
