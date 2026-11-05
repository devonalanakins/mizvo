-- An immutable, versioned statement of the customer's problem and desired outcome.
-- Internal drafts are never included in the customer projection.
CREATE TABLE project_brief_revisions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  version INTEGER NOT NULL CHECK(version >= 1),
  problem TEXT NOT NULL,
  audience TEXT NOT NULL,
  outcome TEXT NOT NULL,
  exclusions TEXT NOT NULL DEFAULT '',
  next_step TEXT NOT NULL DEFAULT '',
  visibility TEXT NOT NULL CHECK(visibility IN ('internal','client')),
  actor_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE(project_id,version)
);
CREATE INDEX idx_project_brief_latest ON project_brief_revisions(project_id,version DESC);
-- Existing requests remain valid legacy requests without a brief/preview binding.
ALTER TABLE client_decision_requests ADD COLUMN brief_version INTEGER;
ALTER TABLE client_decision_requests ADD COLUMN preview_release_id TEXT REFERENCES releases(id);
