import prisma from '../db/prisma.js';
import { logger } from '../utils/logger.js';
import { addJob } from '../queues/queue.js';
import { QUEUE_NAMES } from '../config/constants.js';
import { getSessionPath } from '../utils/sessionManager.js';
import { getProxyForAccount } from '../utils/proxyManager.js';
import { encryptPassword } from '../utils/encryption.js';
import { getVncPort, initializeDisplayForAccount } from '../utils/displayManager.js';

export async function getAccounts(req, res, next) {
  try {
    const accounts = await prisma.account.findMany({
      select: {
        id: true,
        username: true,
        status: true,
        proxy: true,
        sessionPath: true,
        lastActive: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: { reels: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
    
    // Add VNC port information to each account
    const accountsWithVnc = accounts.map(account => ({
      ...account,
      vncPort: getVncPort(account.id)
    }));
    
    res.json(accountsWithVnc);
  } catch (error) {
    next(error);
  }
}

export async function getAccount(req, res, next) {
  try {
    const { id } = req.params;
    const account = await prisma.account.findUnique({
      where: { id: parseInt(id) },
      include: {
        reels: {
          take: 10,
          orderBy: { processedAt: 'desc' }
        },
        logs: {
          take: 50,
          orderBy: { createdAt: 'desc' }
        }
      }
    });

    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }

    // Don't return password in response
    const { password: _, ...accountResponse } = account;
    
    // Add VNC port information
    const accountWithVnc = {
      ...accountResponse,
      vncPort: getVncPort(account.id)
    };
    
    res.json(accountWithVnc);
  } catch (error) {
    next(error);
  }
}

export async function createAccount(req, res, next) {
  try {
    const { username, password, proxy } = req.body;

    if (!username) {
      return res.status(400).json({ error: 'Username is required' });
    }

    // Encrypt password if provided
    const encryptedPassword = password ? encryptPassword(password) : null;

    const account = await prisma.account.create({
      data: {
        username,
        password: encryptedPassword,
        proxy: proxy || getProxyForAccount(Date.now()), // Temporary ID for proxy assignment
        sessionPath: null,
        status: 'idle'
      }
    });

    // Update with proper session path
    const sessionPath = getSessionPath(account.id);
    await prisma.account.update({
      where: { id: account.id },
      data: { sessionPath }
    });

    // Don't return password in response
    const { password: _, ...accountResponse } = account;

    logger.info(`Created account: ${username} (ID: ${account.id})`);
    res.status(201).json(accountResponse);
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'Username already exists' });
    }
    next(error);
  }
}

export async function updateAccount(req, res, next) {
  try {
    const { id } = req.params;
    const { username, password, proxy, status } = req.body;

    const updateData = {
      ...(username && { username }),
      ...(proxy !== undefined && { proxy }),
      ...(status && { status })
    };

    // Encrypt password if provided
    if (password) {
      updateData.password = encryptPassword(password);
    }

    const account = await prisma.account.update({
      where: { id: parseInt(id) },
      data: updateData
    });

    // Don't return password in response
    const { password: _, ...accountResponse } = account;

    logger.info(`Updated account: ${account.username} (ID: ${id})`);
    res.json(accountResponse);
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Account not found' });
    }
    next(error);
  }
}

export async function deleteAccount(req, res, next) {
  try {
    const { id } = req.params;

    await prisma.account.delete({
      where: { id: parseInt(id) }
    });

    logger.info(`Deleted account ID: ${id}`);
    res.status(204).send();
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Account not found' });
    }
    next(error);
  }
}

export async function startAccount(req, res, next) {
  try {
    const { id } = req.params;

    const account = await prisma.account.findUnique({
      where: { id: parseInt(id) }
    });

    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }

    if (account.status === 'running') {
      return res.status(400).json({ error: 'Account is already running' });
    }

    // Update account status to running FIRST (before adding job to queue)
    // This prevents race condition where bot worker checks status before it's set
    await prisma.account.update({
      where: { id: account.id },
      data: { status: 'running', lastActive: new Date() }
    });

    // Initialize display and VNC server for this account
    try {
      const { display, vncPort } = await initializeDisplayForAccount(account.id);
      logger.info(`Initialized display :${display} and VNC port ${vncPort} for account ${account.username}`);
    } catch (error) {
      logger.error(`Failed to initialize display for account ${account.username}:`, error);
      // Continue anyway - the bot will try to initialize it
    }

    // Add job to queue
    await addJob(QUEUE_NAMES.BOT_WORKER, {
      accountId: account.id,
      username: account.username
    });

    logger.info(`Started bot for account: ${account.username} (ID: ${id})`);
    res.json({ message: 'Bot started', account });
  } catch (error) {
    next(error);
  }
}

export async function stopAccount(req, res, next) {
  try {
    const { id } = req.params;

    const account = await prisma.account.findUnique({
      where: { id: parseInt(id) }
    });

    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }

    // Update account status (worker will check this and stop)
    await prisma.account.update({
      where: { id: account.id },
      data: { status: 'stopped' }
    });

    logger.info(`Stopped bot for account: ${account.username} (ID: ${id})`);
    res.json({ message: 'Bot stopped', account });
  } catch (error) {
    next(error);
  }
}

