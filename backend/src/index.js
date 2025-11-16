import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import accountRoutes from './routes/accounts.js';
import reelRoutes from './routes/reels.js';
import outreachRoutes from './routes/outreach.js';
import logRoutes from './routes/logs.js';
import { logger } from './utils/logger.js';
import { config } from './config/env.js';
// Log startup time to verify hot-reload is working
const startupTime = new Date().toISOString();
console.log(`\n🔥 [HOT-RELOAD] Server starting at ${startupTime} 🔥`);
console.log(`📁 Watching for file changes in: ${import.meta.url}\n`);

import './workers/botWorker.js'; // Start the worker

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '../../shared/.env') });

const app = express();
const PORT = config.PORT || 4000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`);
  next();
});

// Routes
app.use('/api/accounts', accountRoutes);
app.use('/api/reels', reelRoutes);
app.use('/api/outreach', outreachRoutes);
app.use('/api/logs', logRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handling
app.use((err, req, res, next) => {
  logger.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error'
  });
});

// Start server
app.listen(PORT, () => {
  logger.info(`🚀 Server running on port ${PORT}`);
  logger.info(`Environment: ${config.NODE_ENV}`);
});

export default app;

