-- Restaurant Council schema
-- Private source preference text lives ONLY in preference_vault.
-- Council/event APIs must never join that table except through PreferenceVault.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  display_name TEXT,
  email TEXT UNIQUE,
  phone TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  date TEXT,
  location_label TEXT,
  latitude REAL,
  longitude REAL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id) REFERENCES users(id)
);

CREATE TABLE event_members (
  event_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  status TEXT NOT NULL,
  joined_at TEXT,
  PRIMARY KEY (event_id, user_id),
  FOREIGN KEY (event_id) REFERENCES events(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE invitations (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  invited_by TEXT NOT NULL,
  type TEXT NOT NULL,
  destination TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (event_id) REFERENCES events(id),
  FOREIGN KEY (invited_by) REFERENCES users(id)
);

-- Public metadata. public_value is NULL when visibility = PRIVATE.
CREATE TABLE preferences (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  category TEXT NOT NULL,
  visibility TEXT NOT NULL,
  priority TEXT NOT NULL,
  public_value TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (event_id) REFERENCES events(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Separate security domain. No other service should query this table.
CREATE TABLE preference_vault (
  id TEXT PRIMARY KEY,
  preference_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  category TEXT NOT NULL,
  source_text TEXT,
  structured_value TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (preference_id) REFERENCES preferences(id)
);

CREATE TABLE derived_constraints (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  type TEXT NOT NULL,
  value TEXT NOT NULL,
  priority TEXT NOT NULL,
  visibility TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE council_sessions (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  state_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  event_id TEXT,
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  resource TEXT,
  decision TEXT,
  reason TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_start TEXT NOT NULL
);

CREATE INDEX idx_event_members_user ON event_members(user_id);
CREATE INDEX idx_preferences_event ON preferences(event_id);
CREATE INDEX idx_vault_user_event ON preference_vault(user_id, event_id);
CREATE INDEX idx_constraints_event ON derived_constraints(event_id);
CREATE INDEX idx_audit_event ON audit_events(event_id);
CREATE INDEX idx_invitations_event ON invitations(event_id);
