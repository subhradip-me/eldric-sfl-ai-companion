import { ChatMessage } from '../models/ChatMessage.js';
import { User } from '../models/User.js';
import { runAgent } from '../services/orchestrator.js';

export const chatController = {
  /**
   * Send a message to the AI assistant
   */
  async sendMessage(req, res) {
    try {
      const { message, sessionId = 'default' } = req.body;

      if (!message || !message.trim()) {
        return res.status(400).json({
          success: false,
          error: 'Message is required',
        });
      }

      // Get user to check farm ID
      const user = await User.findById(req.userId);
      
      if (!user || !user.farm_id) {
        return res.status(400).json({
          success: false,
          error: 'No farm ID associated with your account. Please set your farm ID in settings.',
        });
      }

      // Fetch prior conversation history for multi-turn context
      const priorMessages = await ChatMessage.findBySession(sessionId, req.userId).catch(() => []);

      // Run AI agent with user context and conversation history
      const { answer, steps } = await runAgent(message, sessionId, req.userId, user.farm_id, priorMessages);

      // Save messages asynchronously (user-specific)
      ChatMessage.create({
        sessionId,
        role: 'user',
        content: message,
        userId: req.userId,
      }).catch((err) => console.warn('Failed to save user message:', err.message));

      ChatMessage.create({
        sessionId,
        role: 'assistant',
        content: answer,
        userId: req.userId,
      }).catch((err) => console.warn('Failed to save assistant message:', err.message));

      return res.json({
        success: true,
        answer,
        steps,
      });
    } catch (error) {
      console.error('Chat error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to process message',
      });
    }
  },

  /**
   * Get all chat sessions for the user
   */
  async getSessions(req, res) {
    try {
      const sessions = await ChatMessage.listSessions(req.userId);

      return res.json({
        success: true,
        sessions,
      });
    } catch (error) {
      console.error('Get sessions error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch sessions',
      });
    }
  },

  /**
   * Get messages for a specific session
   */
  async getSession(req, res) {
    try {
      const { id } = req.params;

      const messages = await ChatMessage.findBySession(id, req.userId);

      return res.json({
        success: true,
        messages,
      });
    } catch (error) {
      console.error('Get session error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch session messages',
      });
    }
  },

  /**
   * Delete a chat session
   */
  async deleteSession(req, res) {
    try {
      const { id } = req.params;

      await ChatMessage.deleteSession(id, req.userId);

      return res.json({
        success: true,
        message: 'Session deleted successfully',
      });
    } catch (error) {
      console.error('Delete session error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to delete session',
      });
    }
  },
};
