import pg from "pg";
import bcrypt from "bcryptjs";

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  allowExitOnIdle: false,
  // Fixes ECONNRESET on Docker Desktop for Windows
  ssl: false,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});

// Prevent unhandled 'error' events from crashing the process
pool.on('error', (err) => {
  console.error('⚠️  Idle DB client error (will reconnect):', err.message);
});

export async function init() {
  // ── 1. Users table (must exist before FK references below) ──────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(50) UNIQUE NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      farm_id VARCHAR(100),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_login TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_users_farm_id ON users(farm_id);
  `);

  // ── 2. Snapshots table (basic columns only — no user_id index yet) ───────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS snapshots (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      created_at BIGINT NOT NULL,
      xp DOUBLE PRECISION,
      flower TEXT,
      coins DOUBLE PRECISION,
      state_hash TEXT,
      data_json JSONB NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_snapshots_created ON snapshots(created_at);
  `);

  // ── 3. pgvector extension (optional — catch so it doesn't abort chain) ───────
  await pool.query(`CREATE EXTENSION IF NOT EXISTS vector;`).catch(() => {
    console.warn("⚠️  pgvector not available — semantic recall disabled");
  });

  // ── 4. Chat messages table (basic columns only — no user_id index yet) ───────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id SERIAL PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      user_id INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_chat_session ON chat_messages(session_id, created_at);
  `);

  // ── 5. Migrations: safely add user_id + FK if they don't already exist ───────
  //    ADD COLUMN IF NOT EXISTS is a no-op when the column already exists.
  //    We add the column without FK first, then add the constraint separately
  //    so we can use IF NOT EXISTS semantics (native FK IF NOT EXISTS is pg 9.6+).
  await pool.query(`
    ALTER TABLE snapshots     ADD COLUMN IF NOT EXISTS user_id INTEGER;
    ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS user_id INTEGER;
  `);

  // Add FK constraints idempotently (skip if constraint already exists)
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'snapshots_user_id_fkey'
      ) THEN
        ALTER TABLE snapshots
          ADD CONSTRAINT snapshots_user_id_fkey
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chat_messages_user_id_fkey'
      ) THEN
        ALTER TABLE chat_messages
          ADD CONSTRAINT chat_messages_user_id_fkey
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
      END IF;
    END$$;
  `);

  // ── 6. Create user_id indexes AFTER the column is guaranteed to exist ────────
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_snapshots_user_created  ON snapshots(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_chat_user_session       ON chat_messages(user_id, session_id, created_at);
  `);

  // ── 7. Seed default developer account if not present ─────────────────────────
  try {
    const devUser = await pool.query('SELECT id FROM users WHERE username = $1', ['dev']);
    if (devUser.rows.length === 0) {
      const devHash = await bcrypt.hash('developer123', 10);
      await pool.query(
        `INSERT INTO users (username, email, password_hash, farm_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (username) DO NOTHING`,
        ['dev', 'dev@sunflower-ai.internal', devHash, '346853928974080']
      );
      console.log('🛠️  Developer account seeded: username: dev / password: developer123 / farm: 346853928974080');
    }
  } catch (seedErr) {
    console.warn('⚠️  Could not seed dev account (will proceed):', seedErr.message);
  }
}
