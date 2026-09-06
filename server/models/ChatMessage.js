import { pool } from '../db/database.js';

export const ChatMessage = {
  /**
   * Save a chat message with user association
   */
  async create({ sessionId, role, content, userId, embedding = null }) {
    const result = await pool.query(
      `INSERT INTO chat_messages (session_id, role, content, embedding, user_id, created_at) 
       VALUES ($1, $2, $3, $4, $5, $6) 
       RETURNING *`,
      [sessionId, role, content, embedding, userId, Date.now()]
    );
    return result.rows[0];
  },

  /**
   * Get messages for a session (user-specific)
   */
  async findBySession(sessionId, userId) {
    const result = await pool.query(
      `SELECT id, session_id, role, content, created_at 
       FROM chat_messages 
       WHERE session_id = $1 AND (user_id = $2 OR user_id IS NULL)
       ORDER BY created_at ASC`,
      [sessionId, userId]
    );
    return result.rows;
  },

  /**
   * List all sessions for a user
   */
  async listSessions(userId) {
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
    return result.rows;
  },

  /**
   * Delete all messages for a session (user must own it)
   */
  async deleteSession(sessionId, userId) {
    await pool.query(
      'DELETE FROM chat_messages WHERE session_id = $1 AND user_id = $2',
      [sessionId, userId]
    );
  },

  /**
   * Search messages by similarity (if vector extension available)
   */
  async searchSimilar(embedding, userId, limit = 5) {
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
      return result.rows;
    } catch (error) {
      // Vector extension might not be available
      return [];
    }
  },
};
