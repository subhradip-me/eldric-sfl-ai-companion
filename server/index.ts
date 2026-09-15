import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { init } from "./db/database.js";
import apiRoutes from "./routes/index.js";

import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientDistPath = path.resolve(__dirname, "../client/dist");

const app = express();
const port = process.env.PORT || 3000;

// Trust exactly 1 reverse proxy hop (Docker / Nginx) to prevent X-Forwarded-For spoofing
app.set('trust proxy', 1);

// Middleware
app.use(cors({ 
  origin: process.env.CLIENT_URL || true, 
  credentials: true 
}));
app.use(express.json());
app.use(cookieParser());

// Top-level Docker healthcheck endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ ok: true, timestamp: Date.now(), uptime: process.uptime() });
});

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

// Serve client SPA in production if built
if (fs.existsSync(clientDistPath)) {
  app.use(express.static(clientDistPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
}

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
