-- Read-only URL reachability observations are distinct from release approval.
CREATE TABLE preview_observations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  release_id TEXT NOT NULL REFERENCES releases(id),
  preview_url TEXT NOT NULL,
  expected_commit TEXT NOT NULL,
  result TEXT NOT NULL CHECK(result IN ('reachable','http_error','redirect_denied','network_error')),
  http_status INTEGER CHECK(http_status IS NULL OR (http_status BETWEEN 100 AND 599)),
  reported_commit TEXT,
  commit_matches INTEGER CHECK(commit_matches IS NULL OR commit_matches IN (0,1)),
  actor_id TEXT NOT NULL REFERENCES users(id),
  observed_at TEXT NOT NULL
);
CREATE INDEX idx_preview_observations_release ON preview_observations(release_id,observed_at DESC,id);
