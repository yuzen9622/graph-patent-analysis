-- ---------------------------------------------------------------------------
-- 006_p4_units_metrics.sql — PRD v2 / P4 second slice: 分單位社群（Q2）+ 每單位指標（Q4/Q5）
--
-- NOT fully additive: communities 主鍵要加 `unit` 維度（Q2 定案：`(analysis_id,
-- unit, community_id)`），因此必須 drop 舊主鍵再重建。除此之外皆 ADD COLUMN /
-- CREATE TABLE，資料不回寫。應用在已上線資料庫安全（既有社群列 unit 缺省 'patent'）。
--
-- No BEGIN/COMMIT — runMigrations() 各檔包在一個交易裡。
-- ---------------------------------------------------------------------------

-- （Q2）communities 主鍵加單位維度。
ALTER TABLE communities ADD COLUMN IF NOT EXISTS unit text NOT NULL DEFAULT 'patent';
ALTER TABLE communities DROP CONSTRAINT IF EXISTS communities_pkey;
ALTER TABLE communities ADD PRIMARY KEY (analysis_id, unit, community_id);

-- 概念節點在此分析中的「家」單位社群（舊資料此行 NULL）。
ALTER TABLE concepts ADD COLUMN IF NOT EXISTS community_id_applicants integer;

-- 概念 → 社群歸屬按單位各存一份（Q2；不依賴載入時重算）。label＝concept label。
CREATE TABLE IF NOT EXISTS concept_communities (
  analysis_id  uuid    NOT NULL REFERENCES analyses (id) ON DELETE CASCADE,
  label        text    NOT NULL,
  unit         text    NOT NULL,
  community_id integer NOT NULL,
  PRIMARY KEY (analysis_id, label, unit)
);

-- 邊的全量每單位指標（Q4：門檻前全量；Q5：NPMI p_ij=1 → NULL）。
-- `support_count`/`jaccard` 已是「篇」單位（保留沿用）；以下為「家」單位 + NPMI/association。
ALTER TABLE edges ADD COLUMN IF NOT EXISTS support_applicants            integer;
ALTER TABLE edges ADD COLUMN IF NOT EXISTS jaccard_applicants           double precision;
ALTER TABLE edges ADD COLUMN IF NOT EXISTS npmi                          double precision;
ALTER TABLE edges ADD COLUMN IF NOT EXISTS npmi_applicants              double precision;
ALTER TABLE edges ADD COLUMN IF NOT EXISTS association_strength         double precision;
ALTER TABLE edges ADD COLUMN IF NOT EXISTS association_strength_applicants double precision;