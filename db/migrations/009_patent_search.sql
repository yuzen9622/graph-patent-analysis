CREATE TABLE patent_search_jobs (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prompt text NOT NULL,
  summary text NOT NULL,
  plan jsonb NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'awaiting_approval'
    CHECK (status IN ('awaiting_approval','queued','running','completed','partial','failed','cancelled')),
  stage text CHECK (stage IN ('search','retrieve','export')),
  matched_count integer,
  records jsonb NOT NULL DEFAULT '[]',
  warnings jsonb NOT NULL DEFAULT '[]',
  error text,
  artifact_bytes bytea CHECK (octet_length(artifact_bytes) <= 10485760),
  artifact_rows integer,
  artifact_expires_at timestamptz,
  lease_token uuid,
  lease_until timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX patent_search_owner_created ON patent_search_jobs(owner_id, created_at DESC);
CREATE INDEX patent_search_queue ON patent_search_jobs(status, created_at);
CREATE UNIQUE INDEX patent_search_one_active_per_owner ON patent_search_jobs(owner_id)
  WHERE status IN ('queued','running');

CREATE TABLE patent_search_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES patent_search_jobs(id) ON DELETE CASCADE,
  stage text,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX patent_search_events_job ON patent_search_events(job_id, id);

CREATE TABLE patent_search_proposals (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX patent_search_proposals_owner ON patent_search_proposals(owner_id, created_at);

CREATE TABLE patent_search_worker (
  id integer PRIMARY KEY CHECK (id = 1),
  seen_at timestamptz NOT NULL
);
