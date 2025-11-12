import { Worker } from 'bullmq';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { connection } from '../queues/queue.js';
import { runPlaywrightBot } from './playwrightBot.js';
import prisma from '../db/prisma.js';
import { ACCOUNT_STATUS } from '../config/constants.js';
import { saveLogToDB } from '../utils/dbLogger.js';

// Create worker to process bot jobs
export const botWorker = new Worker(
  'bot-worker',
  async (job) => {
    const { accountId, username } = job.data;
    
    logger.info(`Processing bot job for account: ${username} (ID: ${accountId})`);

    try {
      // Check if account should still be running
      const account = await prisma.account.findUnique({
        where: { id: accountId }
      });

      if (!account) {
        throw new Error(`Account ${accountId} not found`);
      }

      if (account.status !== 'running') {
        logger.info(`Account ${accountId} status is ${account.status}, stopping bot`);
        return { status: 'stopped', reason: account.status };
      }

      // Run the Playwright bot
      const result = await runPlaywrightBot(account);

      // Update account last active time
      await prisma.account.update({
        where: { id: accountId },
        data: { lastActive: new Date() }
      });

      logger.info(`Bot job completed for account: ${username} (ID: ${accountId})`);
      return result;
    } catch (error) {
      logger.error(`Bot job failed for account: ${username} (ID: ${accountId}):`, error);
      
      // Save error to database logs
      try {
        await saveLogToDB(accountId, 'error', `Bot job failed: ${error.message || String(error)}`);
      } catch (logError) {
        logger.error('Failed to save error log:', logError);
      }
      
      // Update account status to error
      try {
        await prisma.account.update({
          where: { id: accountId },
          data: { status: ACCOUNT_STATUS.ERROR }
        });
      } catch (updateError) {
        logger.error('Failed to update account status:', updateError);
      }

      throw error;
    }
  },
  {
    connection,
    concurrency: config.MAX_CONCURRENT_BOTS,
    limiter: {
      max: config.MAX_CONCURRENT_BOTS,
      duration: 1000
    }
  }
);

// Worker event handlers
botWorker.on('completed', (job) => {
  logger.info(`Worker completed job ${job.id}`);
});

botWorker.on('failed', (job, err) => {
  logger.error(`Worker failed job ${job?.id}:`, err);
});

botWorker.on('error', (err) => {
  logger.error('Worker error:', err);
});

logger.info(`Bot worker started with concurrency: ${config.MAX_CONCURRENT_BOTS}`);

