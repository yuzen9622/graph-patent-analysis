-- ---------------------------------------------------------------------------
-- 007_p6_temporal.sql — PRD v2 / P6 依中位申請年排序的技術關聯圖
-- No BEGIN/COMMIT: lib/db/client.ts runs every migration inside one transaction.
-- ---------------------------------------------------------------------------

ALTER TABLE concepts
  ALTER COLUMN median_year TYPE double precision USING median_year::double precision;
ALTER TABLE concepts ADD COLUMN IF NOT EXISTS q1_year integer;
ALTER TABLE concepts ADD COLUMN IF NOT EXISTS q3_year integer;
ALTER TABLE concepts ADD COLUMN IF NOT EXISTS median_loo_min double precision;
ALTER TABLE concepts ADD COLUMN IF NOT EXISTS median_loo_max double precision;

ALTER TABLE edges ADD COLUMN IF NOT EXISTS citation_supported boolean;
ALTER TABLE edges ADD COLUMN IF NOT EXISTS citation_direction_conflict boolean;

CREATE TABLE IF NOT EXISTS citation_edges (
  analysis_id uuid NOT NULL REFERENCES analyses ON DELETE CASCADE,
  edge_id text NOT NULL,
  from_node text NOT NULL,
  to_node text NOT NULL,
  forward_count integer NOT NULL,
  reverse_count integer NOT NULL,
  supported boolean NOT NULL,
  direction_conflict boolean NOT NULL,
  PRIMARY KEY (analysis_id, edge_id)
);
