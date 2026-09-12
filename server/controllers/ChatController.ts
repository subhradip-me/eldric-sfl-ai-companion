/**
 * ChatController — Express HTTP handlers for chat routes.
 * Delegates to ChatStoreService, UserModel, and the Orchestrator.
 */
import type { Request, Response } from 'express';
import { chatStoreService } from '../services/chat/index.js';
import { UserModel } from '../models/UserModel.js';
import { orchestrator } from '../services/ai/index.js';

type AuthReq = Request & { userId: number };

export class ChatController {
  private userModel = new UserModel();

  /** POST /api/chat — send a message and receive an AI answer */
  async sendMessage(req: Request, res: Response): Promise<void> {
    try {
      const { userId } = req as AuthReq;
      const { message, sessionId = 'default' } = req.body as { message?: string; sessionId?: string };

      if (!message || !message.trim()) {
        res.status(400).json({ success: false, error: 'Message is required' });
        return;
      }

      const user = await this.userModel.findById(userId);
      const isDevUser = user?.username === 'dev';
      const devFarmId = (req.headers['x-dev-farm-id'] as string | undefined)?.trim();
      const effectiveFarmId = (isDevUser && devFarmId) ? devFarmId : user?.farm_id;

      if (!effectiveFarmId) {
        res.status(400).json({ success: false, error: 'No farm ID associated with your account. Please set your farm ID in settings.' });
        return;
      }

      const priorMessages = await chatStoreService.getSession(sessionId, userId).catch(() => []);
      const response = await orchestrator.runAgent(message, sessionId, userId, effectiveFarmId, priorMessages);

      // Save messages fire-and-forget
      chatStoreService.saveMessage({ sessionId, role: 'user', content: message, userId })
        .catch((err) => console.warn('Failed to save user message:', (err as Error).message));
      chatStoreService.saveMessage({ sessionId, role: 'assistant', content: response.answer, userId })
        .catch((err) => console.warn('Failed to save assistant message:', (err as Error).message));

      res.json({
        success: true,
        answer: response.answer,
        steps: response.steps,
        warnings: response.warnings,
        provenance: response.provenance,
      });
    } catch (error) {
      console.error('Chat error:', error);
      res.status(500).json({ success: false, error: 'Failed to process message' });
    }
  }

  /** GET /api/chat/sessions — list all sessions for the user */
  async getSessions(req: Request, res: Response): Promise<void> {
    try {
      const { userId } = req as AuthReq;
      const sessions = await chatStoreService.listSessions(userId);
      res.json({ success: true, sessions });
    } catch (error) {
      console.error('Get sessions error:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch sessions' });
    }
  }

  /** GET /api/chat/sessions/:id — get messages for a specific session */
  async getSession(req: Request, res: Response): Promise<void> {
    try {
      const { userId } = req as AuthReq;
      const { id } = req.params as { id: string };
      const messages = await chatStoreService.getSession(id, userId);
      res.json({ success: true, messages });
    } catch (error) {
      console.error('Get session error:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch session messages' });
    }
  }

  /** DELETE /api/chat/sessions/:id — delete a session */
  async deleteSession(req: Request, res: Response): Promise<void> {
    try {
      const { userId } = req as AuthReq;
      const { id } = req.params as { id: string };
      await chatStoreService.deleteSession(id, userId);
      res.json({ success: true, message: 'Session deleted successfully' });
    } catch (error) {
      console.error('Delete session error:', error);
      res.status(500).json({ success: false, error: 'Failed to delete session' });
    }
  }
}

export const chatController = new ChatController();
