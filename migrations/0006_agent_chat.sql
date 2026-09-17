-- Agent-assisted event chat: invocations, evidence cache, richer chat messages.

ALTER TABLE event_chat_messages ADD COLUMN sender_agent_id TEXT;
ALTER TABLE event_chat_messages ADD COLUMN related_agent_invocation_id TEXT;
ALTER TABLE event_chat_messages ADD COLUMN related_restaurant_ids_json TEXT;
ALTER TABLE event_chat_messages ADD COLUMN cards_json TEXT;
ALTER TABLE event_chat_messages ADD COLUMN offer_verification_json TEXT;

CREATE TABLE agent_invocations (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  source_message_id TEXT NOT NULL,
  response_message_id TEXT,
  visibility TEXT NOT NULL,
  status TEXT NOT NULL,
  query TEXT NOT NULL,
  resolved_restaurant_ids_json TEXT,
  answer_json TEXT,
  started_at TEXT,
  completed_at TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (event_id) REFERENCES events(id)
);

CREATE INDEX idx_agent_invocations_event ON agent_invocations (event_id, created_at);

CREATE TABLE restaurant_research_cache (
  cache_key TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  retrieved_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
