import prisma from '../db/prisma.js';
import { logger } from '../utils/logger.js';

export async function getOutreach(req, res, next) {
  try {
    const { limit = 50, offset = 0, sent } = req.query;
    
    const where = {};
    if (sent !== undefined) {
      where.sent = sent === 'true';
    }

    const outreach = await prisma.outreach.findMany({
      where,
      include: {
        reel: {
          include: {
            account: {
              select: { id: true, username: true }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit),
      skip: parseInt(offset)
    });

    res.json(outreach);
  } catch (error) {
    next(error);
  }
}

export async function getOutreachByReel(req, res, next) {
  try {
    const { reelId } = req.params;

    const outreach = await prisma.outreach.findMany({
      where: { reelId: parseInt(reelId) },
      orderBy: { createdAt: 'desc' }
    });

    res.json(outreach);
  } catch (error) {
    next(error);
  }
}

export async function createOutreach(req, res, next) {
  try {
    const { reelId, targetUser, message } = req.body;

    if (!reelId || !targetUser || !message) {
      return res.status(400).json({ error: 'reelId, targetUser, and message are required' });
    }

    const outreach = await prisma.outreach.create({
      data: {
        reelId: parseInt(reelId),
        targetUser,
        message
      },
      include: {
        reel: {
          include: {
            account: {
              select: { id: true, username: true }
            }
          }
        }
      }
    });

    logger.info(`Created outreach for reel ${reelId} to user ${targetUser}`);
    res.status(201).json(outreach);
  } catch (error) {
    next(error);
  }
}

export async function updateOutreach(req, res, next) {
  try {
    const { id } = req.params;
    const { sent, sentAt } = req.body;

    const outreach = await prisma.outreach.update({
      where: { id: parseInt(id) },
      data: {
        ...(sent !== undefined && { sent }),
        ...(sentAt && { sentAt: new Date(sentAt) })
      }
    });

    logger.info(`Updated outreach ID: ${id}`);
    res.json(outreach);
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Outreach not found' });
    }
    next(error);
  }
}

