-- PNHS Records - SF10 permanent record store (demo MVP subset).
--
-- Deferred from the full design: remedial_records, certifications, import_log.
-- Nothing in the demo touches them.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS students (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Learner Reference Number. The only reliable identity key: Filipino name matching is
  -- defeated by suffixes, middle initials and inconsistent spacing.
  lrn          TEXT    NOT NULL UNIQUE,
  last_name    TEXT    NOT NULL,
  first_name   TEXT    NOT NULL,
  middle_name  TEXT,
  name_ext     TEXT,
  sex          TEXT CHECK (sex IN ('M', 'F')),
  birthdate    TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_students_last_name ON students (last_name);

CREATE TABLE IF NOT EXISTS jhs_eligibility (
  student_id            INTEGER PRIMARY KEY REFERENCES students (id) ON DELETE CASCADE,
  elem_school_name      TEXT,
  elem_school_id        TEXT,
  elem_school_address   TEXT,
  elem_general_average  REAL,
  citation              TEXT,
  pept_rating           TEXT,
  als_rating            TEXT,
  other_credential      TEXT,
  exam_date             TEXT,
  testing_center        TEXT
);

CREATE TABLE IF NOT EXISTS shs_eligibility (
  student_id             INTEGER PRIMARY KEY REFERENCES students (id) ON DELETE CASCADE,
  shs_admission_date     TEXT,
  jhs_completer_gen_ave  REAL,
  hs_completer_gen_ave   REAL,
  graduation_date        TEXT,
  prev_school_name       TEXT,
  prev_school_address    TEXT,
  pept_rating            TEXT,
  als_rating             TEXT,
  other_credential       TEXT,
  exam_date              TEXT,
  clc_name_address       TEXT
);

-- One row per grade level (JHS) or per semester (SHS) the student attended.
CREATE TABLE IF NOT EXISTS enrollment_terms (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id        INTEGER NOT NULL REFERENCES students (id) ON DELETE CASCADE,
  level             INTEGER NOT NULL CHECK (level BETWEEN 7 AND 12),
  -- NULL for JHS; 1 or 2 for SHS.
  semester          INTEGER CHECK (semester IN (1, 2)),
  school_year       TEXT,
  section           TEXT,
  adviser           TEXT,
  track_strand      TEXT,
  school_name       TEXT,
  school_id         TEXT,
  district          TEXT,
  division          TEXT,
  region            TEXT,
  promotion_remark  TEXT,
  UNIQUE (student_id, level, semester)
);

CREATE INDEX IF NOT EXISTS idx_terms_student ON enrollment_terms (student_id);

-- Subjects are rows, not columns: JHS has a fixed 13-14 learning areas but SHS subject
-- lists vary by track/strand.
CREATE TABLE IF NOT EXISTS term_subjects (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  term_id       INTEGER NOT NULL REFERENCES enrollment_terms (id) ON DELETE CASCADE,
  ordinal       INTEGER NOT NULL,
  subject_name  TEXT    NOT NULL,
  -- SHS only: Core | Applied | Specialized | Other_Subjects.
  category      TEXT,
  q1            REAL,
  q2            REAL,
  q3            REAL,
  q4            REAL,
  -- Only stored for rows the SF10 template does not compute itself, i.e. JHS Homeroom
  -- Guidance and CAT. Everywhere else the template's own AVERAGE formula owns this.
  final_rating  REAL,
  remarks       TEXT,
  UNIQUE (term_id, ordinal)
);

CREATE INDEX IF NOT EXISTS idx_subjects_term ON term_subjects (term_id);

CREATE TABLE IF NOT EXISTS school_settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);

-- One row per SF10 file taken in. The hash is what makes re-importing a folder safe and
-- collapses byte-identical duplicates (the school's set contains such a pair).
CREATE TABLE IF NOT EXISTS import_files (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  filename     TEXT    NOT NULL,
  sha256       TEXT    NOT NULL UNIQUE,
  form         TEXT    NOT NULL,
  student_id   INTEGER REFERENCES students (id) ON DELETE SET NULL,
  status       TEXT    NOT NULL,
  notes        TEXT,
  imported_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Anything a human should look at. Nothing is ever dropped on import; it is flagged here.
CREATE TABLE IF NOT EXISTS import_issues (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  import_file_id  INTEGER NOT NULL REFERENCES import_files (id) ON DELETE CASCADE,
  student_id      INTEGER REFERENCES students (id) ON DELETE CASCADE,
  severity        TEXT    NOT NULL,
  field           TEXT,
  cell            TEXT,
  raw_value       TEXT,
  message         TEXT    NOT NULL,
  resolved        INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_issues_student ON import_issues (student_id);

-- The school's own identity, taken from the values already present in its SF10 templates.
-- Seeded here rather than by a script because getDb() re-runs this file on every boot, so
-- the settings repair themselves and survive the database being emptied. INSERT OR IGNORE
-- means an edit made in the app is never overwritten on the next start.
INSERT OR IGNORE INTO school_settings (key, value) VALUES
  ('school_name',         'PANTAO NATIONAL HIGH SCHOOL'),
  ('school_id',           '301860'),
  ('district',            '3rd Dist.-LIBON WEST'),
  ('division',            'ALBAY'),
  ('region',              'V'),
  ('principal',           'HILDA S. SECILLANO'),
  ('elem_school_name',    'PANTAO  ELEMENTARY SCHOOL'),
  ('elem_school_id',      '111798'),
  ('elem_school_address', 'PANTAO, LIBON, ALBAY');
