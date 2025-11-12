import { Queue } from 'bullmq';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';
import Redis from 'ioredis';

// Create Redis connection
const connection = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: null
});

// Create queue instance
export const botQueue = new Queue('bot-worker', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000
    },
    removeOnComplete: {
      age: 3600, // Keep completed jobs for 1 hour
      count: 1000
    },
    removeOnFail: {
      age: 86400 // Keep failed jobs for 24 hours
    }
  }
});

/**
 * Add a job to the queue
 */
export async function addJob(queueName, data, options = {}) {
  try {
    const job = await botQueue.add(queueName, data, options);
    logger.info(`Job added to queue: ${job.id}`, { data });
    return job;
  } catch (error) {
    logger.error('Error adding job to queue:', error);
    throw error;
  }
}

/**
 * Get queue stats
 */
export async function getQueueStats() {
  try {
    const [waiting, active, completed, failed] = await Promise.all([
      botQueue.getWaitingCount(),
      botQueue.getActiveCount(),
      botQueue.getCompletedCount(),
      botQueue.getFailedCount()
    ]);

    return {
      waiting,
      active,
      completed,
      failed,
      total: waiting + active + completed + failed
    };
  } catch (error) {
    logger.error('Error getting queue stats:', error);
    return null;
  }
}

// Handle queue events
botQueue.on('completed', (job) => {
  logger.info(`Job ${job.id} completed`);
});

botQueue.on('failed', (job, err) => {
  logger.error(`Job ${job.id} failed:`, err);
});

export { connection };

