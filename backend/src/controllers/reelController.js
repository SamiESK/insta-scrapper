import prisma from '../db/prisma.js';
import { logger } from '../utils/logger.js';

export async function getReels(req, res, next) {
  try {
    const { limit = 50, offset = 0, minViews } = req.query;
    
    const where = {};
    if (minViews) {
      where.views = { gte: parseInt(minViews) };
    }

    const reels = await prisma.reel.findMany({
      where,
      include: {
        account: {
          select: { id: true, username: true }
        },
        _count: {
          select: { outreach: true }
        }
      },
      orderBy: { processedAt: 'desc' },
      take: parseInt(limit),
      skip: parseInt(offset)
    });

    res.json(reels);
  } catch (error) {
    next(error);
  }
}

export async function getReel(req, res, next) {
  try {
    const { id } = req.params;
    const reel = await prisma.reel.findUnique({
      where: { id: parseInt(id) },
      include: {
        account: true,
        outreach: true
      }
    });

    if (!reel) {
      return res.status(404).json({ error: 'Reel not found' });
    }

    res.json(reel);
  } catch (error) {
    next(error);
  }
}

export async function getReelsByAccount(req, res, next) {
  try {
    const { accountId } = req.params;
    const { limit = 50 } = req.query;

    const reels = await prisma.reel.findMany({
      where: { accountId: parseInt(accountId) },
      include: {
        _count: {
          select: { outreach: true }
        }
      },
      orderBy: { processedAt: 'desc' },
      take: parseInt(limit)
    });

    res.json(reels);
  } catch (error) {
    next(error);
  }
}

export async function createReel(req, res, next) {
  try {
    const { accountId, reelUrl, views, isAd, isLive } = req.body;

    if (!accountId || !reelUrl) {
      return res.status(400).json({ error: 'accountId and reelUrl are required' });
    }

    const reel = await prisma.reel.create({
      data: {
        accountId: parseInt(accountId),
        reelUrl,
        views: parseInt(views) || 0,
        isAd: isAd || false,
        isLive: isLive || false
      },
      include: {
        account: {
          select: { id: true, username: true }
        }
      }
    });

    logger.info(`Created reel: ${reelUrl} for account ${accountId}`);
    res.status(201).json(reel);
  } catch (error) {
    next(error);
  }
}

