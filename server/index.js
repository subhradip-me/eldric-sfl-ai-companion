import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { init } from "./db/database.js";
import apiRoutes from "./routes/index.js";

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors({ 
  origin: process.env.CLIENT_URL || true, 
  credentials: true 
}));
app.use(express.json());
app.use(cookieParser());

// Request logging middleware (development)
if (process.env.NODE_ENV !== 'production') {
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
    next();
  });
}

// Error handling wrapper
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch((error) => {
    console.error('Request error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message || 'Internal server error' 
    });
  });
};

// Mount API routes
app.use('/api', apiRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    success: false,
    error: 'Endpoint not found' 
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ 
    success: false,
    error: process.env.NODE_ENV === 'production' 
      ? 'Internal server error' 
      : err.message 
  });
});

// Initialize database with retry (handles slow-starting Docker containers)
async function connectWithRetry(maxAttempts = 10, baseDelayMs = 2000) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await init();
      return true;
    } catch (err) {
      const isLastAttempt = attempt === maxAttempts;
      if (isLastAttempt) {
        throw err;
      }
      const delay = Math.min(baseDelayMs * 2 ** (attempt - 1), 32000);
      console.warn(
        `⚠️  DB not ready (attempt ${attempt}/${maxAttempts}): ${err.message}. Retrying in ${delay / 1000}s...`
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

connectWithRetry()
  .then(() => {
    console.log('✅ Database initialized');
    app.listen(port, () => {
      console.log(`🌻 Sunflower AI server running on port ${port}`);
      console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🔗 Health check: http://localhost:${port}/api/health`);
    });
  })
  .catch((error) => {
    console.warn('⚠️  Database unavailable (some features disabled):', error.message);
    // Start server anyway - some features will work without DB
    app.listen(port, () => {
      console.log(`🌻 Sunflower AI server running on port ${port} (limited mode)`);
    });
  });

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing server');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT signal received: closing server');
  process.exit(0);
});
