-- P6 full-analysis scope identity metadata. Dynamic view scope is always
-- recomputed from current options; this only preserves the build-time record.
ALTER TABLE analyses ADD COLUMN IF NOT EXISTS scope_id text;
