import prisma from '../db/prisma.js';
import { logger } from '../utils/logger.js';

export async function getLogs(req, res, next) {
  try {
    const { accountId } = req.params;
    const { limit = 100 } = req.query;

    const logs = await prisma.log.findMany({
      where: { accountId: parseInt(accountId) },
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit)
    });

    res.json(logs);
  } catch (error) {
    next(error);
  }
}

