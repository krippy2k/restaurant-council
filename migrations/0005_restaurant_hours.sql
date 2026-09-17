-- Event timezone and restaurant hours search policy.

ALTER TABLE events ADD COLUMN timezone TEXT;
ALTER TABLE events ADD COLUMN restaurant_search_policy TEXT;
