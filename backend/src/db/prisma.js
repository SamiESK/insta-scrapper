import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger.js';

const prisma = new PrismaClient({
  log: [
    { level: 'query', emit: 'event' },
    { level: 'error', emit: 'stdout' },
    { level: 'warn', emit: 'stdout' }
  ]
});

// Log queries in development
if (process.env.NODE_ENV === 'development') {
  prisma.$on('query', (e) => {
    logger.debug(`Query: ${e.query} - Duration: ${e.duration}ms`);
  });
}

// Handle connection errors
prisma.$connect()
  .then(() => {
    logger.info('✅ Database connected');
  })
  .catch((error) => {
    logger.error('❌ Database connection error:', error);
  });

export default prisma;

