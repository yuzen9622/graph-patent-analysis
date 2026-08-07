-- PRD v2 / P4 down migration.
ALTER TABLE concepts DROP COLUMN IF EXISTS applicant_count;
DROP INDEX IF EXISTS concepts_applicant_count_idx;