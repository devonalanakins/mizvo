PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS organizations (id TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL,
 password_hash TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS organization_members (
 organization_id TEXT NOT NULL REFERENCES organizations(id), user_id TEXT NOT NULL REFERENCES users(id),
 role TEXT NOT NULL CHECK(role IN ('founder','member')), PRIMARY KEY(organization_id,user_id)
);
CREATE TABLE IF NOT EXISTS sessions (
 hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), csrf TEXT NOT NULL,
 created_at TEXT NOT NULL, expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id),
 name TEXT NOT NULL, purpose TEXT NOT NULL, scope TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'discovery'
 CHECK(status IN ('discovery','scoping','design','engineering','review','delivered','support')),
 owner_id TEXT NOT NULL REFERENCES users(id), version INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS memberships (
 project_id TEXT NOT NULL REFERENCES projects(id), user_id TEXT NOT NULL REFERENCES users(id),
 role TEXT NOT NULL CHECK(role IN ('owner','contributor','client')), expires_at TEXT, revoked_at TEXT,
 PRIMARY KEY(project_id,user_id)
);
CREATE TABLE IF NOT EXISTS records (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
 kind TEXT NOT NULL CHECK(kind IN ('discussion','note','decision','feedback','support','design')),
 title TEXT NOT NULL, body TEXT NOT NULL, visibility TEXT NOT NULL CHECK(visibility IN ('internal','client')),
 state TEXT NOT NULL DEFAULT 'open' CHECK(state IN ('open','proposed','approved','rejected','resolved')),
 actor_id TEXT NOT NULL REFERENCES users(id), version INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS record_history (
 id TEXT PRIMARY KEY, record_id TEXT NOT NULL REFERENCES records(id), version INTEGER NOT NULL,
 title TEXT NOT NULL, body TEXT NOT NULL, state TEXT NOT NULL, actor_id TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL, UNIQUE(record_id,version)
);
CREATE TABLE IF NOT EXISTS tasks (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), title TEXT NOT NULL,
 milestone TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('todo','doing','blocked','review','done')),
 priority TEXT NOT NULL CHECK(priority IN ('normal','high')), evidence TEXT NOT NULL DEFAULT '',
 review_required INTEGER NOT NULL DEFAULT 1, reviewed_by TEXT REFERENCES users(id),
 depends_on TEXT REFERENCES tasks(id), visibility TEXT NOT NULL CHECK(visibility IN ('internal','client')),
 actor_id TEXT NOT NULL REFERENCES users(id), version INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS invitations (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), email TEXT NOT NULL COLLATE NOCASE,
 role TEXT NOT NULL CHECK(role IN ('contributor','client')), token_hash TEXT NOT NULL UNIQUE,
 expires_at TEXT NOT NULL, access_expires_at TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES users(id), accepted_by TEXT REFERENCES users(id),
 accepted_at TEXT, revoked_at TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS inquiries (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id), name TEXT NOT NULL,
 email TEXT NOT NULL, goal TEXT NOT NULL, details TEXT NOT NULL, consent_at TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','qualified','scoping','approved','closed')),
 project_id TEXT REFERENCES projects(id), version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS repositories (
 project_id TEXT PRIMARY KEY REFERENCES projects(id), full_name TEXT NOT NULL, connected_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS releases (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), label TEXT NOT NULL,
 summary TEXT NOT NULL, commit_sha TEXT NOT NULL, demo_url TEXT NOT NULL, artifact_url TEXT NOT NULL,
 rollback TEXT NOT NULL, visibility TEXT NOT NULL CHECK(visibility IN ('internal','client')),
 actor_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS release_reviews (
 id TEXT PRIMARY KEY, release_id TEXT NOT NULL REFERENCES releases(id), actor_id TEXT NOT NULL REFERENCES users(id),
 outcome TEXT NOT NULL CHECK(outcome IN ('approved','changes_requested')), comment TEXT NOT NULL,
 created_at TEXT NOT NULL, UNIQUE(release_id,actor_id)
);
CREATE TABLE IF NOT EXISTS audit (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
 organization_id TEXT NOT NULL REFERENCES organizations(id), project_id TEXT REFERENCES projects(id),
 actor_id TEXT REFERENCES users(id), action TEXT NOT NULL, object_id TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notifications (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), project_id TEXT NOT NULL REFERENCES projects(id),
 action TEXT NOT NULL, created_at TEXT NOT NULL, read_at TEXT
);
CREATE TABLE IF NOT EXISTS preferences (user_id TEXT PRIMARY KEY REFERENCES users(id), activity INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, resets_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_records_project ON records(project_id,created_at);
CREATE INDEX IF NOT EXISTS idx_audit_project ON audit(project_id,sequence);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id,created_at);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
