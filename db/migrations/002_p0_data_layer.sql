-- ---------------------------------------------------------------------------
-- 002_p0_data_layer.sql — PRD v2 / P0 §6.2
--
-- Fully ADDITIVE: only ADD COLUMN and CREATE TABLE.  No DROP, no primary-key
-- change, no data rewrite, so it is safe to apply to a live database and safe
-- to leave applied if the application code is rolled back.
--
-- Deliberately ABSENT (§5.4 — the exclusion mechanism was cancelled):
--   patents.is_design / is_inactive / is_pending / identity_uncertain
--
-- Deliberately UNTOUCHED: edges.kind.  001_init.sql:170 declares it as plain
-- `text` with no CHECK constraint (the only CHECKs in 001 are
-- users_role_check:23 and analyses_status_check:85), and P0 introduces no new
-- edge kind, so there is nothing to relax.
--
-- No BEGIN/COMMIT here, on purpose: runMigrations() (lib/db/client.ts:75-78)
-- already wraps each file in a transaction together with the
-- `INSERT INTO schema_migrations` row. Opening a nested transaction would make
-- this file's COMMIT close the runner's, so the bookkeeping insert would land
-- outside any transaction. 001_init.sql follows the same convention.
-- ---------------------------------------------------------------------------

-- --- patents ---------------------------------------------------------------
ALTER TABLE patents ADD COLUMN IF NOT EXISTS patent_number       text;
ALTER TABLE patents ADD COLUMN IF NOT EXISTS publication_number  text;
ALTER TABLE patents ADD COLUMN IF NOT EXISTS publication_date    text;
ALTER TABLE patents ADD COLUMN IF NOT EXISTS ipc5                text[];
ALTER TABLE patents ADD COLUMN IF NOT EXISTS ipc5_raw            text[];
ALTER TABLE patents ADD COLUMN IF NOT EXISTS ipc_primary         text;
ALTER TABLE patents ADD COLUMN IF NOT EXISTS ipc_depth           integer;
ALTER TABLE patents ADD COLUMN IF NOT EXISTS cited_by_count      integer;
ALTER TABLE patents ADD COLUMN IF NOT EXISTS case_status         text;
ALTER TABLE patents ADD COLUMN IF NOT EXISTS design_class        text;
ALTER TABLE patents ADD COLUMN IF NOT EXISTS source_files        text[];
ALTER TABLE patents ADD COLUMN IF NOT EXISTS external_references text[];

CREATE INDEX IF NOT EXISTS patents_patent_number_idx ON patents (patent_number);
CREATE INDEX IF NOT EXISTS patents_ipc_primary_idx   ON patents (analysis_id, ipc_primary);

-- --- applicants ------------------------------------------------------------
-- Merge key from normalizeApplicantName() (§3.4).  Stored alongside `name`,
-- never in place of it: the displayed name must stay byte-identical to v1.2.
ALTER TABLE applicants ADD COLUMN IF NOT EXISTS applicant_key text;

CREATE INDEX IF NOT EXISTS applicants_key_idx ON applicants (analysis_id, applicant_key);

-- --- concepts --------------------------------------------------------------
-- Fixes an existing defect: saveGraph() writes patent_concepts but loadGraph()
-- never reads it back, so GraphNode.source_patents silently vanished on reload.
ALTER TABLE concepts ADD COLUMN IF NOT EXISTS source_patents text[];

-- --- analyses --------------------------------------------------------------
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS data_quality_warnings jsonb;

-- --- analysis_uploads ------------------------------------------------------
-- analyses.upload_id / analyses.filename (001_init.sql:62-64) are single-valued,
-- so after a multi-file upload the history sidebar could only ever show one
-- filename and "download original" could only ever hand back one file.
CREATE TABLE IF NOT EXISTS analysis_uploads (
  analysis_id   uuid NOT NULL REFERENCES analyses (id) ON DELETE CASCADE,
  upload_id     uuid NOT NULL REFERENCES uploads (id)  ON DELETE CASCADE,
  original_name text,
  PRIMARY KEY (analysis_id, upload_id)
);

CREATE INDEX IF NOT EXISTS analysis_uploads_upload_idx ON analysis_uploads (upload_id);

-- --- citations -------------------------------------------------------------
-- Internal 參考文獻 links only (§3.5): a reference that matches no 專利編號 in
-- the dataset stays in patents.external_references[] and creates no row here.
-- Hence no `is_internal` column — it would be constant true.
-- from_patent / to_patent hold PatentRow.id values (= patents.node_id minus the
-- `patent:` prefix), not bigserial ids, so citation rows can be written before
-- the patents rows have been assigned surrogate keys.
CREATE TABLE IF NOT EXISTS citations (
  analysis_id uuid NOT NULL REFERENCES analyses (id) ON DELETE CASCADE,
  from_patent text NOT NULL,
  to_patent   text NOT NULL,
  PRIMARY KEY (analysis_id, from_patent, to_patent)
);

CREATE INDEX IF NOT EXISTS citations_to_idx ON citations (analysis_id, to_patent);
