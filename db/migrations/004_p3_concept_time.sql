-- ---------------------------------------------------------------------------
-- 004_p3_concept_time.sql — PRD v2 / P3 概念時間
--
-- Fully ADDITIVE (like 002/003): only ADD COLUMN.  No DROP, no primary-key
-- change, no data rewrite.  Safe to apply to a live database and safe to
-- leave applied on rollback.
--
-- Adds the four per-concept time metadata columns.  The gradient window and
-- palette name live on analyses.methodology (already an opaque jsonb blob),
-- so no new table column is needed for them.
--
-- No BEGIN/COMMIT here, on purpose: runMigrations() (lib/db/client.ts) wraps
-- each file in a transaction together with the bookkeeping INSERT. 001/002/003
-- follow the same convention.
-- ---------------------------------------------------------------------------

ALTER TABLE concepts ADD COLUMN IF NOT EXISTS first_year   integer;
ALTER TABLE concepts ADD COLUMN IF NOT EXISTS last_year    integer;
ALTER TABLE concepts ADD COLUMN IF NOT EXISTS median_year  integer;
ALTER TABLE concepts ADD COLUMN IF NOT EXISTS year_counts  jsonb;

CREATE INDEX IF NOT EXISTS concepts_first_year_idx ON concepts (analysis_id, first_year);