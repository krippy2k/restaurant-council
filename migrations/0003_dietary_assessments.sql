-- Cached dietary assessments are restaurant-level, never keyed by participant.

CREATE TABLE dietary_assessments (
  id TEXT PRIMARY KEY,
  restaurant_id TEXT NOT NULL,
  requirement TEXT NOT NULL,
  evidence_mode TEXT NOT NULL,
  status TEXT NOT NULL,
  confidence REAL NOT NULL,
  analyzed_at TEXT NOT NULL,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(restaurant_id, requirement, evidence_mode)
);

CREATE TABLE dietary_evidence (
  id TEXT PRIMARY KEY,
  assessment_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_url TEXT,
  source_name TEXT,
  supports TEXT NOT NULL,
  reliability TEXT NOT NULL,
  scope TEXT,
  excerpt TEXT,
  observed_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (assessment_id) REFERENCES dietary_assessments(id) ON DELETE CASCADE
);

CREATE INDEX idx_dietary_assessments_lookup
  ON dietary_assessments(restaurant_id, requirement, evidence_mode);
CREATE INDEX idx_dietary_evidence_assessment ON dietary_evidence(assessment_id);
