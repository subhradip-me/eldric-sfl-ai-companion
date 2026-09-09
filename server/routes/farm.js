import express from 'express';
import { farmController } from '../controllers/farmController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// All farm routes require authentication
router.get('/farm', authenticateToken, farmController.getFarmData);
router.get('/market', farmController.getMarket); // Market data doesn't need auth
router.get('/planner', authenticateToken, farmController.getPlanner);
router.get('/activity', authenticateToken, farmController.getActivity);
router.get('/xp-progression', authenticateToken, farmController.getXpProgression);
router.get('/recipes', authenticateToken, farmController.getRecipes);


export default router;
