-- ---------------------------------------------------------------------------
-- 003_p1_synonyms.sql — PRD v2 / P1 同義詞治理
--
-- Fully ADDITIVE (like 002): only CREATE TABLE + ADD COLUMN.  No DROP, no
-- primary-key change, no data rewrite, safe to apply to a live database and
-- safe to leave applied on rollback.
--
-- Two pieces:
--   1. synonym_groups  — the global, human-editable, cross-analysis dictionary.
--      canonical is the representative label; aliases[] are normalised onto it
--      at the co-occurrence INPUT layer (see lib/concept-network.ts and
--      decision #6 in docs/PRD-v2-意圖.md).
--   2. analyses.synonym_snapshot — the immutable copy of the dictionary used
--      when THIS analysis ran.  Stored per-analysis so an old analysis never
--      changes when the global dictionary is later edited.
--
-- No BEGIN/COMMIT here, on purpose: runMigrations() (lib/db/client.ts) already
-- wraps each file in a transaction with the bookkeeping INSERT. 001/002 follow
-- the same convention.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS synonym_groups (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical  text NOT NULL UNIQUE,
  aliases    text[] NOT NULL DEFAULT '{}',
  note       text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Case-insensitive lookup on aliases (the input-layer hot path resolves every
-- keyword): index each alias row via ANY.  Stored lowercase to survive the
-- immutable array index while allowing exact matching.
CREATE INDEX IF NOT EXISTS synonym_groups_aliases_idx
  ON synonym_groups USING GIN (aliases);

-- Immutable per-analysis snapshot of the active dictionary (P1).
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS synonym_snapshot jsonb;