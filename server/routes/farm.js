import express from 'express';
import { farmController } from '../controllers/FarmController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// All farm routes require authentication except /market
router.get('/farm', authenticateToken, (req, res) => farmController.getFarmData(req, res));
router.get('/market', (req, res) => farmController.getMarket(req, res));
router.get('/planner', authenticateToken, (req, res) => farmController.getPlanner(req, res));
router.get('/activity', authenticateToken, (req, res) => farmController.getActivity(req, res));
router.get('/xp-progression', authenticateToken, (req, res) => farmController.getXpProgression(req, res));
router.get('/recipes', authenticateToken, (req, res) => farmController.getRecipes(req, res));

export default router;
