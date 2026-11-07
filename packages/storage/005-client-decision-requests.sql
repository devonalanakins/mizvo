-- Client decision requests do not approve releases or internal proposals.
CREATE TABLE client_decision_requests (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id),
 client_id TEXT NOT NULL REFERENCES users(id),
 actor_id TEXT NOT NULL REFERENCES users(id),
 title TEXT NOT NULL,
 body TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','answered','cancelled')),
 version INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE TABLE client_decision_responses (
 id TEXT PRIMARY KEY,
 request_id TEXT NOT NULL UNIQUE REFERENCES client_decision_requests(id),
 client_id TEXT NOT NULL REFERENCES users(id),
 request_version INTEGER NOT NULL,
 outcome TEXT NOT NULL CHECK(outcome IN ('accepted','changes_requested')),
 comment TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX idx_client_decisions_project ON client_decision_requests(project_id,created_at DESC,id);
CREATE INDEX idx_client_decisions_recipient ON client_decision_requests(project_id,client_id,status);
