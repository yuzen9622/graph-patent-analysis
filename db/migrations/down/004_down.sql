-- 004_down.sql — rollback for 004_p3_concept_time.sql (all additive, fully reversible).
DROP INDEX IF EXISTS concepts_first_year_idx;
ALTER TABLE concepts DROP COLUMN IF EXISTS year_counts;
ALTER TABLE concepts DROP COLUMN IF EXISTS median_year;
ALTER TABLE concepts DROP COLUMN IF EXISTS last_year;
ALTER TABLE concepts DROP COLUMN IF EXISTS first_year;