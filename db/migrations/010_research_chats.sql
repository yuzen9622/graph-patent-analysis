CREATE TABLE research_chats (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  first_prompt text NOT NULL,
  title text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX research_chats_owner_updated ON research_chats(owner_id, updated_at DESC);
CREATE TABLE research_chat_turns (
  id uuid PRIMARY KEY,
  chat_id uuid NOT NULL REFERENCES research_chats(id) ON DELETE CASCADE,
  prompt text NOT NULL,
  context_plan jsonb,
  response text,
  error text,
  job_id uuid REFERENCES patent_search_jobs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX research_chat_turns_order ON research_chat_turns(chat_id, created_at);
