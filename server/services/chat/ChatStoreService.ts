/**
 * ChatStoreService — chat session persistence + pgvector semantic memory.
 * User-scoped: all queries filter by user_id.
 */
import type { SaveMessageInput, ChatMessageRecord, SessionSummary, SimilarMessage } from '../../types/index.js';
import { pool } from '../../db/database.js';
import { embeddingService } from '../ai/EmbeddingService.js';

export class ChatStoreService {
  /** Persist a chat message, optionally with a vector embedding for RAG. */
  async saveMessage(input: SaveMessageInput): Promise<void> {
    const { sessionId, role, content, userId, embedding = null } = input;
    if (!userId) {
      console.warn('No userId provided for saveMessage');
      return;
    }

    let vec: string | null = null;
    try {
      vec = embeddingService.toVec(await embeddingService.embed(content));
    } catch {
      /* embeddings are optional */
    }

    await pool.query(
      'INSERT INTO chat_messages (session_id, role, content, embedding, user_id, created_at) VALUES ($1,$2,$3,$4,$5,$6)',
      [sessionId, role, content, vec, userId, Date.now()]
    );
  }

  /**
   * Find semantically similar messages from OTHER sessions for cross-session memory.
   * Returns top-k results filtered by cosine similarity threshold (>0.45).
   */
  async similar(
    text: string,
    currentSessionId: string,
    userId: number,
    k = 4
  ): Promise<SimilarMessage[]> {
    if (!userId) return [];
    const vec = embeddingService.toVec(await embeddingService.embed(text));
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
      .filter((x) => (x.score as number) > 0.45)
      .map(({ role, content, score }: { role: string; content: string; score: number }) => ({
        role,
        content: (content as string).slice(0, 500),
        score: +score.toFixed(2),
      }));
  }

  /** List sessions for a user, ordered by most recent activity. */
  async listSessions(userId: number, limit = 50): Promise<SessionSummary[]> {
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
    return r.rows as SessionSummary[];
  }

  /** Get all messages in a session for a user (ordered ascending). */
  async getSession(sessionId: string, userId: number): Promise<ChatMessageRecord[]> {
    if (!userId) return [];
    const r = await pool.query(
      'SELECT role, content, created_at FROM chat_messages WHERE session_id = $1 AND user_id = $2 ORDER BY created_at',
      [sessionId, userId]
    );
    return r.rows as ChatMessageRecord[];
  }

  /** Delete all messages in a session (must be owned by the user). */
  async deleteSession(sessionId: string, userId: number): Promise<void> {
    await pool.query(
      'DELETE FROM chat_messages WHERE session_id = $1 AND user_id = $2',
      [sessionId, userId]
    );
  }
}

export const chatStoreService = new ChatStoreService();
