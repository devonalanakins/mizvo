-- Legacy reviews have no reliable role-at-write provenance. Keep them internal.
-- Do not infer historical visibility from a user's current project role.
ALTER TABLE release_reviews ADD COLUMN audience TEXT NOT NULL DEFAULT 'internal'
 CHECK(audience IN ('internal','client'));
