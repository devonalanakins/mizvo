-- Versioned hosting/handoff intentions, not proof of account ownership or deployment.
-- Never store billing details, provider credentials, private access tokens or secrets here.
CREATE TABLE project_ownership_revisions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  revision INTEGER NOT NULL CHECK(revision>=1),
  hosting_model TEXT NOT NULL CHECK(hosting_model IN (
    'undecided','client_owned_mizvo_operated','mizvo_hosted','client_self_hosted'
  )),
  planned_domain TEXT NOT NULL DEFAULT '',
  infrastructure_owner TEXT NOT NULL DEFAULT '',
  billing_owner TEXT NOT NULL DEFAULT '',
  operator TEXT NOT NULL DEFAULT '',
  export_plan TEXT NOT NULL DEFAULT '',
  support_scope TEXT NOT NULL DEFAULT '',
  visibility TEXT NOT NULL CHECK(visibility IN ('internal','client')),
  actor_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE(project_id,revision)
);
CREATE INDEX idx_ownership_latest ON project_ownership_revisions(project_id,revision DESC);
