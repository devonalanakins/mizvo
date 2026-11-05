CREATE TABLE release_source_evidence (
 id TEXT PRIMARY KEY,
 release_id TEXT NOT NULL REFERENCES releases(id),
 repository TEXT NOT NULL,
 commit_sha TEXT NOT NULL,
 tree_sha TEXT NOT NULL,
 ci_state TEXT NOT NULL CHECK(ci_state IN ('success','failure','pending','no_checks')),
 checks_json TEXT NOT NULL,
 actor_id TEXT NOT NULL REFERENCES users(id),
 observed_at TEXT NOT NULL
);
CREATE INDEX idx_release_evidence ON release_source_evidence(release_id,observed_at);
