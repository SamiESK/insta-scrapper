import prisma from '../db/prisma.js';

/**
 * Save log to database for an account
 */
export async function saveLogToDB(accountId, level, message, metadata = null) {
  try {
    await prisma.log.create({
      data: {
        accountId,
        level,
        message,
        metadata: metadata ? JSON.stringify(metadata) : null
      }
    });
  } catch (error) {
    // Don't throw - logging shouldn't break the app
    console.error('Failed to save log to DB:', error);
  }
}

