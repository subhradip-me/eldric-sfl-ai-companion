import pg from "pg";

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

export async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS snapshots (
      id SERIAL PRIMARY KEY,
      created_at BIGINT NOT NULL,
      xp DOUBLE PRECISION,
      flower TEXT,
      coins DOUBLE PRECISION,
      state_hash TEXT,
      data_json JSONB NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_snapshots_created ON snapshots(created_at);
  `);
  await pool.query(`
    CREATE EXTENSION IF NOT EXISTS vector;
    CREATE TABLE IF NOT EXISTS chat_messages (
      id SERIAL PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,             -- 'user' | 'assistant'
      content TEXT NOT NULL,
      embedding vector(384),          -- all-MiniLM-L6-v2
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chat_session ON chat_messages(session_id, created_at);
  `);
}
