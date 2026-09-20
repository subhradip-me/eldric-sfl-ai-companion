-- Run once against your Postgres DB (needs the pgvector extension available).
--
-- Dimension is set for OpenAI text-embedding-3-small (1536). If you use a
-- different embedding model, change the `vector(1536)` below to match
-- (e.g. 1024 for Voyage voyage-2, 384/768 for common local models, etc.)
-- BEFORE running this — changing it later means recreating the column.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS kb_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source TEXT NOT NULL DEFAULT 'sfl-wiki',
    path TEXT NOT NULL UNIQUE,          -- e.g. "/en/mechanics/animals/chicken"
    url TEXT,
    title TEXT,
    description TEXT,
    author_name TEXT,
    wiki_updated_at TIMESTAMPTZ,        -- the wiki's own updated-at, not ours
    content_hash TEXT NOT NULL,         -- hash of the raw markdown; drives re-ingestion skip
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kb_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES kb_documents(id) ON DELETE CASCADE,

    heading_path TEXT[] NOT NULL,       -- e.g. ["Chickens", "Feeder machine"]
    chunk_index INT NOT NULL DEFAULT 0, -- >0 when a section had to be split further

    category TEXT,                      -- coarse, path-derived (see deriveCategory)
    type TEXT,                          -- rough heuristic classification, nullable
    entity TEXT,                        -- page title, v1 simplification

    content TEXT NOT NULL,              -- self-contained text actually embedded
    structured_data JSONB,              -- parsed table(s) for this chunk, if any

    content_hash TEXT NOT NULL,         -- hash of `content`; skip re-embedding if unchanged
    embedding vector(384),

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (document_id, heading_path, chunk_index)
);

CREATE INDEX IF NOT EXISTS kb_chunks_embedding_idx
    ON kb_chunks USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS kb_chunks_category_idx ON kb_chunks (category);
CREATE INDEX IF NOT EXISTS kb_chunks_type_idx ON kb_chunks (type);
CREATE INDEX IF NOT EXISTS kb_chunks_entity_idx ON kb_chunks (entity);
