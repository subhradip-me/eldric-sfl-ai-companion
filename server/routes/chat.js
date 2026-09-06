import express from 'express';
import { chatController } from '../controllers/chatController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// All chat routes require authentication
router.post('/chat', authenticateToken, chatController.sendMessage);
router.get('/sessions', authenticateToken, chatController.getSessions);
router.get('/sessions/:id', authenticateToken, chatController.getSession);
router.delete('/sessions/:id', authenticateToken, chatController.deleteSession);

export default router;
