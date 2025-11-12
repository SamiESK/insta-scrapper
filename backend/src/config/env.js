import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '../../../shared/.env') });

export const config = {
  PORT: process.env.PORT || 4000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  DATABASE_URL: process.env.DATABASE_URL,
  REDIS_URL: process.env.REDIS_URL || 'redis://redis:6379',
  PROXY_LIST: process.env.PROXY_LIST ? process.env.PROXY_LIST.split(',') : [],
  PLAYWRIGHT_HEADLESS: process.env.PLAYWRIGHT_HEADLESS === 'true',
  MAX_CONCURRENT_BOTS: parseInt(process.env.MAX_CONCURRENT_BOTS || '10', 10),
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY
};

