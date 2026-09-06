import express from 'express';
import { authController } from '../controllers/authController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Public routes
router.post('/register', authController.register);
router.post('/login', authController.login);

// Protected routes
router.get('/me', authenticateToken, authController.me);
router.put('/farm', authenticateToken, authController.updateFarmId);
router.put('/password', authenticateToken, authController.changePassword);

export default router;
