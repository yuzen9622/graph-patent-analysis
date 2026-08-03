-- 001_init.sql — accounts, sessions, uploads and normalised analysis results.
--
-- Storage rule for this project: binary artefacts (uploaded .xlsx, exported
-- .html) NEVER live in the database. Only their URL/path is stored, in
-- `uploads`. Everything structured — patents, applicants, concepts, edges,
-- communities — is normalised into tables so research queries (year slices,
-- applicant type, co-occurrence strength) are plain SQL.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Accounts ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username       text        NOT NULL,
  password_hash  text        NOT NULL,
  password_salt  text        NOT NULL,  -- per-user random salt, 16 bytes hex
  display_name   text,
  role           text        NOT NULL DEFAULT 'researcher',
  is_active      boolean     NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_login_at  timestamptz,
  CONSTRAINT users_role_check CHECK (role IN ('admin', 'researcher'))
);

-- Usernames are case-insensitive without depending on the citext extension.
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_idx ON users (lower(username));

CREATE TABLE IF NOT EXISTS sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash   text        NOT NULL UNIQUE,  -- sha256 of the cookie token
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  ip           text,
  user_agent   text
);

CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions (expires_at);

-- ── Uploaded files: path only, never the bytes ──────────────────────────────

CREATE TABLE IF NOT EXISTS uploads (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      uuid        REFERENCES users (id) ON DELETE SET NULL,
  original_name text        NOT NULL,
  stored_path   text        NOT NULL,  -- absolute path inside the container
  content_type  text,
  byte_size     bigint,
  sha256        text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS uploads_owner_idx ON uploads (owner_id);

-- ── Analyses ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS analyses (
  id              uuid PRIMARY KEY,          -- same id as the job / share URL
  owner_id        uuid        REFERENCES users (id) ON DELETE SET NULL,
  upload_id       uuid        REFERENCES uploads (id) ON DELETE SET NULL,
  filename        text,
  status          text        NOT NULL DEFAULT 'running',
  error           text,
  provider        text,
  model_id        text,
  prompt_version  text,
  sample_size     integer,
  applicant_count integer     NOT NULL DEFAULT 0,
  patent_count    integer     NOT NULL DEFAULT 0,
  concept_count   integer     NOT NULL DEFAULT 0,
  community_count integer     NOT NULL DEFAULT 0,
  year_min        integer,
  year_max        integer,
  schema_version  integer     NOT NULL DEFAULT 2,
  methodology     jsonb,
  god_nodes       jsonb,
  surprising      jsonb,
  ai_report       text,
  generated_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  CONSTRAINT analyses_status_check CHECK (status IN ('running', 'done', 'cancelled', 'error'))
);

CREATE INDEX IF NOT EXISTS analyses_owner_idx ON analyses (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS analyses_status_idx ON analyses (status);

-- ── Graph contents (normalised) ─────────────────────────────────────────────
-- `node_id` keeps the in-graph identifier ("concept:行動支付") so the exact
-- GraphData shape can be rebuilt without re-deriving ids.

CREATE TABLE IF NOT EXISTS applicants (
  id           bigserial PRIMARY KEY,
  analysis_id  uuid    NOT NULL REFERENCES analyses (id) ON DELETE CASCADE,
  node_id      text    NOT NULL,
  name         text    NOT NULL,
  country      text,           -- parsed from the raw applicant cell when available
  org_type     text,           -- 金控 / 銀行 / 保險 / 證券 / 科技 / 學研 / 其他
  patent_count integer NOT NULL DEFAULT 0,
  color        text,
  size         real,
  UNIQUE (analysis_id, node_id)
);

CREATE TABLE IF NOT EXISTS patents (
  id                  bigserial PRIMARY KEY,
  analysis_id         uuid NOT NULL REFERENCES analyses (id) ON DELETE CASCADE,
  node_id             text NOT NULL,
  title               text,
  abstract            text,
  translated_abstract text,
  applicant_raw       text,
  application_number  text,
  filing_date         text,
  year                integer,
  search_keyword      text,
  color               text,
  size                real,
  UNIQUE (analysis_id, node_id)
);

CREATE INDEX IF NOT EXISTS patents_analysis_year_idx ON patents (analysis_id, year);
CREATE INDEX IF NOT EXISTS patents_app_number_idx ON patents (application_number);

CREATE TABLE IF NOT EXISTS patent_applicants (
  patent_id    bigint NOT NULL REFERENCES patents (id) ON DELETE CASCADE,
  applicant_id bigint NOT NULL REFERENCES applicants (id) ON DELETE CASCADE,
  PRIMARY KEY (patent_id, applicant_id)
);

CREATE TABLE IF NOT EXISTS concepts (
  id           bigserial PRIMARY KEY,
  analysis_id  uuid    NOT NULL REFERENCES analyses (id) ON DELETE CASCADE,
  node_id      text    NOT NULL,
  label        text    NOT NULL,
  frequency    integer NOT NULL DEFAULT 0,
  community_id integer,
  color        text,
  size         real,
  UNIQUE (analysis_id, node_id)
);

CREATE INDEX IF NOT EXISTS concepts_analysis_label_idx ON concepts (analysis_id, label);
CREATE INDEX IF NOT EXISTS concepts_community_idx ON concepts (analysis_id, community_id);

CREATE TABLE IF NOT EXISTS patent_concepts (
  patent_id  bigint NOT NULL REFERENCES patents (id) ON DELETE CASCADE,
  concept_id bigint NOT NULL REFERENCES concepts (id) ON DELETE CASCADE,
  PRIMARY KEY (patent_id, concept_id)
);

CREATE INDEX IF NOT EXISTS patent_concepts_concept_idx ON patent_concepts (concept_id);

CREATE TABLE IF NOT EXISTS communities (
  analysis_id  uuid    NOT NULL REFERENCES analyses (id) ON DELETE CASCADE,
  community_id integer NOT NULL,
  name         text,
  color        text,
  node_count   integer NOT NULL DEFAULT 0,
  PRIMARY KEY (analysis_id, community_id)
);

CREATE TABLE IF NOT EXISTS edges (
  id             bigserial PRIMARY KEY,
  analysis_id    uuid NOT NULL REFERENCES analyses (id) ON DELETE CASCADE,
  edge_id        text NOT NULL,
  kind           text,            -- structural | cooccurrence | semantic (null on pre-v2 imports)
  from_node      text NOT NULL,
  to_node        text NOT NULL,
  relation       text,
  weight         double precision,
  support_count  integer,
  jaccard        double precision,
  reason         text,
  confidence     text,
  source_patent  text,
  source_patents text[],
  evidence       jsonb,
  UNIQUE (analysis_id, edge_id)
);

CREATE INDEX IF NOT EXISTS edges_analysis_kind_idx ON edges (analysis_id, kind);
CREATE INDEX IF NOT EXISTS edges_from_idx ON edges (analysis_id, from_node);
CREATE INDEX IF NOT EXISTS edges_to_idx ON edges (analysis_id, to_node);
