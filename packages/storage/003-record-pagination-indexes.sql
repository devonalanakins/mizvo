CREATE INDEX idx_records_cursor ON records(project_id,created_at DESC,id DESC);
CREATE INDEX idx_records_kind_cursor ON records(project_id,kind,created_at DESC,id DESC);
CREATE INDEX idx_records_client_cursor ON records(project_id,visibility,created_at DESC,id DESC);
