/**
 * ChatMessageModel — database operations for the chat_messages table.
 */
import { pool } from '../db/database.js';
import type { ChatMessageRecord, SessionSummary } from '../types/index.js';

export class ChatMessageModel {
  /** Insert a new chat message record. */
  async create(data: {
    sessionId: string;
    role: string;
    content: string;
    userId: number;
    embedding?: string | null;
  }): Promise<ChatMessageRecord> {
    const { sessionId, role, content, userId, embedding = null } = data;
    const result = await pool.query(
      `INSERT INTO chat_messages (session_id, role, content, embedding, user_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [sessionId, role, content, embedding, userId, Date.now()]
    );
    return result.rows[0] as ChatMessageRecord;
  }

  /** Get all messages in a session (ordered ascending), user-scoped. */
  async findBySession(sessionId: string, userId: number): Promise<ChatMessageRecord[]> {
    const result = await pool.query(
      `SELECT id, session_id, role, content, created_at
       FROM chat_messages
       WHERE session_id = $1 AND (user_id = $2 OR user_id IS NULL)
       ORDER BY created_at ASC`,
      [sessionId, userId]
    );
    return result.rows as ChatMessageRecord[];
  }

  /** List all unique sessions for a user, most recent first. */
  async listSessions(userId: number): Promise<SessionSummary[]> {
    const result = await pool.query(
      `SELECT
         session_id,
         COUNT(*) as messages,
         MIN(created_at) as started_at,
         MAX(created_at) as last_at,
         (SELECT content FROM chat_messages m2
          WHERE m2.session_id = m1.session_id AND m2.role = 'user'
          ORDER BY created_at ASC LIMIT 1) as first_message
       FROM chat_messages m1
       WHERE user_id = $1
       GROUP BY session_id
       ORDER BY last_at DESC`,
      [userId]
    );
    return result.rows as SessionSummary[];
  }

  /** Delete all messages in a session (user must own it). */
  async deleteSession(sessionId: string, userId: number): Promise<void> {
    await pool.query(
      'DELETE FROM chat_messages WHERE session_id = $1 AND user_id = $2',
      [sessionId, userId]
    );
  }

  /** Find similar messages by vector distance (requires pgvector). */
  async searchSimilar(
    embedding: string,
    userId: number,
    limit = 5
  ): Promise<Array<ChatMessageRecord & { distance: number }>> {
    try {
      const result = await pool.query(
        `SELECT session_id, role, content, created_at,
                embedding <-> $1::vector as distance
         FROM chat_messages
         WHERE user_id = $2 AND embedding IS NOT NULL
         ORDER BY distance
         LIMIT $3`,
        [embedding, userId, limit]
      );
      return result.rows as Array<ChatMessageRecord & { distance: number }>;
    } catch {
      return [];
    }
  }
}

/** Singleton for use across controllers and services. */
export const ChatMessage = new ChatMessageModel();
