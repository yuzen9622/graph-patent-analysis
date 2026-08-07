-- PRD v2 / P4: analysis-unit support.
-- Additive only: ADD COLUMN.  Drops / REWRITEs belong in */down/005_down.sql.
-- The heavy lifting (the institution node graph) is computed in the view layer
-- from the structural edges, so this migration only persists the one new
-- concept-level unit metric that survives a reload: applicant_count (家).

ALTER TABLE concepts ADD COLUMN IF NOT EXISTS applicant_count integer;

-- Keep the concept-units look-up cheap when filtering concept networks.
CREATE INDEX IF NOT EXISTS concepts_applicant_count_idx
  ON concepts (analysis_id, applicant_count);