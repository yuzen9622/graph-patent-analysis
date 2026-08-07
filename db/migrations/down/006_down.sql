-- 006_down.sql — reverse 006_p4_units_metrics.sql
-- Order matters: drop the child table & the (analysis_id, unit, community_id) PK
-- first, then collapse `communities` back to its pre-006 single-unit PK.
DROP TABLE IF EXISTS concept_communities;

ALTER TABLE concepts DROP COLUMN IF EXISTS community_id_applicants;

ALTER TABLE edges DROP COLUMN IF EXISTS support_applicants;
ALTER TABLE edges DROP COLUMN IF EXISTS jaccard_applicants;
ALTER TABLE edges DROP COLUMN IF EXISTS npmi;
ALTER TABLE edges DROP COLUMN IF EXISTS npmi_applicants;
ALTER TABLE edges DROP COLUMN IF EXISTS association_strength;
ALTER TABLE edges DROP COLUMN IF EXISTS association_strength_applicants;

ALTER TABLE communities DROP CONSTRAINT IF EXISTS communities_pkey;
ALTER TABLE communities DROP COLUMN IF EXISTS unit;
ALTER TABLE communities ADD PRIMARY KEY (analysis_id, community_id);