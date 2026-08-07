-- 003_down.sql — rollback for 003_p1_synonyms.sql (all additive, so fully reversible).
ALTER TABLE analyses DROP COLUMN IF EXISTS synonym_snapshot;
DROP TABLE IF EXISTS synonym_groups;