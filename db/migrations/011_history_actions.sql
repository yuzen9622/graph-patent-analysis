ALTER TABLE research_chats ADD COLUMN pinned boolean NOT NULL DEFAULT false;
ALTER TABLE patent_search_jobs ADD COLUMN title text, ADD COLUMN pinned boolean NOT NULL DEFAULT false;
ALTER TABLE analyses ADD COLUMN title text, ADD COLUMN pinned boolean NOT NULL DEFAULT false;
