import express from 'express';
import { authController } from '../controllers/AuthController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Public routes
router.post('/register', (req, res) => authController.register(req, res));
router.post('/login', (req, res) => authController.login(req, res));
router.post('/refresh', (req, res) => authController.refresh(req, res));

// Protected routes
router.get('/me', authenticateToken, (req, res) => authController.me(req, res));
router.post('/logout', authenticateToken, (req, res) => authController.logout(req, res));
router.put('/farm', authenticateToken, (req, res) => authController.updateFarmId(req, res));
router.put('/password', authenticateToken, (req, res) => authController.changePassword(req, res));

export default router;
