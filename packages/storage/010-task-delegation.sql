-- V0.17: optional project task delegation; all existing tasks stay unassigned.
-- A task remains project-scoped; assignee eligibility is checked at every write.
ALTER TABLE tasks ADD COLUMN assignee_id TEXT REFERENCES users(id);
ALTER TABLE tasks ADD COLUMN due_date TEXT CHECK(
  due_date IS NULL OR
  (length(due_date)=10 AND due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
);
CREATE INDEX idx_tasks_assignee ON tasks(project_id,assignee_id,status);
CREATE INDEX idx_tasks_due_date ON tasks(project_id,due_date);
