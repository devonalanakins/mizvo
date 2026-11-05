-- Immutable Living Brief revisions and exact client decision bindings.
CREATE TABLE project_brief_revisions (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id),
 revision INTEGER NOT NULL CHECK(revision>=1),
 problem TEXT NOT NULL,
 audience TEXT NOT NULL,
 outcome TEXT NOT NULL,
 success_criteria TEXT NOT NULL,
 exclusions TEXT NOT NULL DEFAULT '',
 assumptions TEXT NOT NULL DEFAULT '',
 visibility TEXT NOT NULL CHECK(visibility IN ('internal','client')),
 actor_id TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL,
 UNIQUE(project_id,revision)
);
CREATE INDEX idx_project_brief_latest ON project_brief_revisions(project_id,revision DESC);

ALTER TABLE client_decision_requests ADD COLUMN brief_revision_id TEXT REFERENCES project_brief_revisions(id);
ALTER TABLE client_decision_requests ADD COLUMN release_id TEXT REFERENCES releases(id);
CREATE INDEX idx_client_decisions_brief ON client_decision_requests(brief_revision_id,status);
