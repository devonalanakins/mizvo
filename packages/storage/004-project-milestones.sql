-- Add real project milestones without changing existing task labels.
CREATE TABLE project_milestones (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id),
 title TEXT NOT NULL,
 summary TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL CHECK(status IN ('planned','active','blocked','review','done')),
 visibility TEXT NOT NULL CHECK(visibility IN ('internal','client')),
 target_date TEXT,
 actor_id TEXT NOT NULL REFERENCES users(id),
 version INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE INDEX idx_project_milestones ON project_milestones(project_id,target_date,created_at,id);
ALTER TABLE tasks ADD COLUMN milestone_id TEXT REFERENCES project_milestones(id);
CREATE INDEX idx_tasks_milestone ON tasks(milestone_id,status);
