import express from 'express';
import authRoutes from './auth.js';
import farmRoutes from './farm.js';
import chatRoutes from './chat.js';

const router = express.Router();

// Health check
router.get('/health', (req, res) => {
  res.json({ 
    ok: true,
    timestamp: Date.now(),
    uptime: process.uptime(),
  });
});

// Mount route modules
router.use('/auth', authRoutes);
router.use('/', farmRoutes);
router.use('/', chatRoutes);

export default router;
