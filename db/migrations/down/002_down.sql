-- ---------------------------------------------------------------------------
-- 002_down.sql — reverse of 002_p0_data_layer.sql (PRD v2 / P0 §6.2)
--
-- 002 was fully additive, so rolling back only removes the columns and tables
-- that 002 introduced. Nothing that existed before 002 is touched.
--
-- WARNING — this file DISCARDS DATA. Dropping patents.ipc5 etc. destroys the
-- parsed IPC values; dropping analysis_uploads destroys the multi-file
-- provenance of every analysis saved while 002 was applied. Because 002 is safe
-- to leave in place (all new columns are nullable, all new tables are ignored by
-- the v1.2 code paths), prefer rolling back the *application* over running this.
--
-- ⚠ HOW THIS FILE INTERACTS WITH THE AUTOMATIC MIGRATOR
--   runMigrations() (lib/db/client.ts:61-63) applies EVERY `*.sql` in this
--   directory, in lexicographic order, exactly once each. `002_down.sql` sorts
--   BEFORE `002_p0_data_layer.sql` ('d' < 'p'), so on a database that has not
--   yet seen 002 it runs first and every statement below is a no-op thanks to
--   the IF EXISTS guards; 002_p0_data_layer.sql then creates everything. The
--   end state is correct.
--   It is NOT safe, however, to apply 002_p0_data_layer.sql by hand (via psql)
--   without also recording a `schema_migrations` row for `002_down.sql`: the
--   next application boot would then run this file for real and drop the new
--   columns. The durable fix is for runMigrations() to skip `*_down.sql`
--   — see the next-stage notes.
--
-- No BEGIN/COMMIT: the runner supplies the transaction (see 002_p0_data_layer.sql).
-- ---------------------------------------------------------------------------

DROP TABLE IF EXISTS citations;
DROP TABLE IF EXISTS analysis_uploads;

ALTER TABLE analyses   DROP COLUMN IF EXISTS data_quality_warnings;

ALTER TABLE concepts   DROP COLUMN IF EXISTS source_patents;

DROP INDEX IF EXISTS applicants_key_idx;
ALTER TABLE applicants DROP COLUMN IF EXISTS applicant_key;

DROP INDEX IF EXISTS patents_ipc_primary_idx;
DROP INDEX IF EXISTS patents_patent_number_idx;
ALTER TABLE patents DROP COLUMN IF EXISTS external_references;
ALTER TABLE patents DROP COLUMN IF EXISTS source_files;
ALTER TABLE patents DROP COLUMN IF EXISTS design_class;
ALTER TABLE patents DROP COLUMN IF EXISTS case_status;
ALTER TABLE patents DROP COLUMN IF EXISTS cited_by_count;
ALTER TABLE patents DROP COLUMN IF EXISTS ipc_depth;
ALTER TABLE patents DROP COLUMN IF EXISTS ipc_primary;
ALTER TABLE patents DROP COLUMN IF EXISTS ipc5_raw;
ALTER TABLE patents DROP COLUMN IF EXISTS ipc5;
ALTER TABLE patents DROP COLUMN IF EXISTS publication_date;
ALTER TABLE patents DROP COLUMN IF EXISTS publication_number;
ALTER TABLE patents DROP COLUMN IF EXISTS patent_number;
