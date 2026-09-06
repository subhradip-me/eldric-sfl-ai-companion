// Persist chat sessions + pgvector similarity search over past messages - User-specific
import { pool } from "../db/database.js";
import { embed, toVec } from "./embeddings.js";

export async function saveMessage(sessionId, role, content, userId) {
  if (!userId) {
    console.warn('No userId provided for saveMessage');
    return;
  }

  let vec = null;
  try { 
    vec = toVec(await embed(content)); 
  } catch { 
    /* embeddings optional */ 
  }

  await pool.query(
    "INSERT INTO chat_messages (session_id, role, content, embedding, user_id, created_at) VALUES ($1,$2,$3,$4,$5,$6)",
    [sessionId, role, content, vec, userId, Date.now()]
  );
}

// Top-k semantically similar past exchanges from OTHER sessions (memory across sessions) - User-specific
export async function similar(text, currentSessionId, userId, k = 4) {
  if (!userId) return [];

  const vec = toVec(await embed(text));
  const r = await pool.query(
    `SELECT role, content, session_id, 1 - (embedding <=> $1) AS score
     FROM chat_messages
     WHERE embedding IS NOT NULL 
       AND session_id <> $2 
       AND user_id = $3
     ORDER BY embedding <=> $1 LIMIT $4`,
    [vec, currentSessionId, userId, k]
  );
  
  return r.rows
    .filter((x) => x.score > 0.45)
    .map(({ role, content, score }) => ({ 
      role, 
      content: content.slice(0, 500), 
      score: +score.toFixed(2) 
    }));
}

export async function listSessions(userId, limit = 50) {
  if (!userId) return [];

  const r = await pool.query(
    `SELECT session_id,
            MIN(created_at) AS started_at,
            MAX(created_at) AS last_at,
            COUNT(*)::int AS messages,
            (ARRAY_AGG(content ORDER BY created_at))[1] AS first_message
     FROM chat_messages 
     WHERE user_id = $1
     GROUP BY session_id 
     ORDER BY MAX(created_at) DESC 
     LIMIT $2`, 
    [userId, limit]
  );
  
  return r.rows;
}

export async function getSession(sessionId, userId) {
  if (!userId) return [];

  const r = await pool.query(
    "SELECT role, content, created_at FROM chat_messages WHERE session_id = $1 AND user_id = $2 ORDER BY created_at", 
    [sessionId, userId]
  );
  
  return r.rows;
}
