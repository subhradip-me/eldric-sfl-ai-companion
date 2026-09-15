import express from 'express';
import { chatController } from '../controllers/ChatController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// All chat routes require authentication
router.post('/chat', authenticateToken, (req, res) => chatController.sendMessage(req, res));
router.get('/sessions', authenticateToken, (req, res) => chatController.getSessions(req, res));
router.get('/sessions/:id', authenticateToken, (req, res) => chatController.getSession(req, res));
router.delete('/sessions/:id', authenticateToken, (req, res) => chatController.deleteSession(req, res));

export default router;
