-- Reverse 007_p6_temporal.sql. Best effort only: rounding median_year cannot
-- recover the old lower-median semantics.
DROP TABLE IF EXISTS citation_edges;

ALTER TABLE edges DROP COLUMN IF EXISTS citation_supported;
ALTER TABLE edges DROP COLUMN IF EXISTS citation_direction_conflict;

ALTER TABLE concepts DROP COLUMN IF EXISTS q1_year;
ALTER TABLE concepts DROP COLUMN IF EXISTS q3_year;
ALTER TABLE concepts DROP COLUMN IF EXISTS median_loo_min;
ALTER TABLE concepts DROP COLUMN IF EXISTS median_loo_max;
ALTER TABLE concepts
  ALTER COLUMN median_year TYPE integer USING round(median_year)::integer;
