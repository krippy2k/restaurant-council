-- Human-in-the-loop collaboration: chat, verification, evidence, decisions, actions.

CREATE TABLE event_chat_messages (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  sender_type TEXT NOT NULL,
  sender_user_id TEXT,
  message_type TEXT NOT NULL,
  text TEXT,
  related_restaurant_id TEXT,
  related_action_id TEXT,
  created_at TEXT NOT NULL,
  edited_at TEXT,
  deleted_at TEXT,
  FOREIGN KEY (event_id) REFERENCES events(id)
);

CREATE TABLE verification_tasks (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  restaurant_id TEXT NOT NULL,
  requirement_type TEXT NOT NULL,
  requirement_value TEXT,
  question TEXT NOT NULL,
  status TEXT NOT NULL,
  created_by_type TEXT NOT NULL,
  created_by_user_id TEXT,
  assigned_to_user_id TEXT,
  created_at TEXT NOT NULL,
  claimed_at TEXT,
  completed_at TEXT,
  FOREIGN KEY (event_id) REFERENCES events(id)
);

CREATE TABLE human_evidence (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  restaurant_id TEXT NOT NULL,
  requirement_type TEXT NOT NULL,
  requirement_value TEXT,
  provided_by_user_id TEXT NOT NULL,
  method TEXT NOT NULL,
  result TEXT NOT NULL,
  notes TEXT,
  verified_at TEXT NOT NULL,
  visibility TEXT NOT NULL,
  FOREIGN KEY (event_id) REFERENCES events(id)
);

CREATE TABLE restaurant_decisions (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  restaurant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  decision TEXT NOT NULL,
  reason_category TEXT,
  note TEXT,
  visibility TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  UNIQUE (event_id, restaurant_id, user_id),
  FOREIGN KEY (event_id) REFERENCES events(id)
);

CREATE TABLE council_actions (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  restaurant_id TEXT,
  actor_user_id TEXT,
  type TEXT NOT NULL,
  visibility TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (event_id) REFERENCES events(id)
);

CREATE TABLE preference_prompts (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  source_message_id TEXT,
  question TEXT NOT NULL,
  category TEXT NOT NULL,
  visibility TEXT NOT NULL,
  priority TEXT NOT NULL,
  value_json TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  FOREIGN KEY (event_id) REFERENCES events(id)
);

CREATE INDEX idx_chat_event ON event_chat_messages(event_id, created_at);
CREATE INDEX idx_verification_event ON verification_tasks(event_id, status);
CREATE INDEX idx_human_evidence_event ON human_evidence(event_id, restaurant_id);
CREATE INDEX idx_decisions_event ON restaurant_decisions(event_id, restaurant_id);
CREATE INDEX idx_actions_event ON council_actions(event_id, created_at);
CREATE INDEX idx_prompts_event_user ON preference_prompts(event_id, user_id, status);
