-- Real restaurant discovery: search area, provider references, and search cache.

ALTER TABLE events ADD COLUMN radius_meters INTEGER;
ALTER TABLE events ADD COLUMN location_source TEXT;
ALTER TABLE events ADD COLUMN location_place_id TEXT;

CREATE TABLE restaurant_references (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  provider_restaurant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  cached_data TEXT,
  cached_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(provider, provider_restaurant_id)
);

CREATE TABLE restaurant_searches (
  id TEXT PRIMARY KEY,
  event_id TEXT,
  provider TEXT NOT NULL,
  location TEXT NOT NULL,
  radius INTEGER NOT NULL,
  constraints TEXT NOT NULL,
  query TEXT,
  result_count INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE restaurant_search_cache (
  cache_key TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE event_restaurant_candidates (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  restaurant_id TEXT NOT NULL,
  search_id TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_restaurant_provider ON restaurant_references(provider, provider_restaurant_id);
CREATE INDEX idx_restaurant_searches_event ON restaurant_searches(event_id);
CREATE INDEX idx_event_restaurant_candidates ON event_restaurant_candidates(event_id);
