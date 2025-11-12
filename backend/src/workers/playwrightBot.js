import { chromium } from 'playwright';
import prisma from '../db/prisma.js';
import { logger } from '../utils/logger.js';
import { loadSession, saveSession, sessionExists } from '../utils/sessionManager.js';
import { getProxyForAccount } from '../utils/proxyManager.js';
import { config } from '../config/env.js';
import { INSTAGRAM_SELECTORS, REEL_FILTERS, ACCOUNT_STATUS } from '../config/constants.js';
import { decryptPassword } from '../utils/encryption.js';
import { saveLogToDB } from '../utils/dbLogger.js';
import { getDisplayEnv, getVncPort, initializeDisplayForAccount } from '../utils/displayManager.js';

/**
 * Remove automation indicators from browser
 */
async function setupStealthMode(page) {
  await page.addInitScript(() => {
    // Remove webdriver property
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined
    });

    // Override plugins
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5]
    });

    // Override languages
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en']
    });

    // Override permissions
    const originalQuery = window.navigator.permissions?.query;
    if (originalQuery) {
      window.navigator.permissions.query = (parameters) => (
        parameters.name === 'notifications' ?
          Promise.resolve({ state: Notification.permission }) :
          originalQuery(parameters)
      );
    }
  });
}

/**
 * Login to Instagram
 */
async function loginToInstagram(page, account) {
  try {
    logger.info(`Logging in account: ${account.username}`);
    await saveLogToDB(account.id, 'info', `Starting login for ${account.username}`);
  } catch (logError) {
    logger.error('Failed to save login log:', logError);
  }

  // Navigate to login page
  await page.goto('https://www.instagram.com/accounts/login/', {
    waitUntil: 'load',
    timeout: 60000
  });

  // Try to find and fill username
  let usernameSelector = null;
  for (const selector of INSTAGRAM_SELECTORS.USERNAME) {
    try {
      await page.waitForSelector(selector, { timeout: 5000 });
      usernameSelector = selector;
      break;
    } catch (e) {
      // Try next selector
    }
  }

  if (!usernameSelector) {
    throw new Error('Could not find username input field');
  }

  await page.fill(usernameSelector, account.username);

  // Try to find and fill password
  let passwordSelector = null;
  for (const selector of INSTAGRAM_SELECTORS.PASSWORD) {
    try {
      await page.waitForSelector(selector, { timeout: 5000 });
      passwordSelector = selector;
      break;
    } catch (e) {
      // Try next selector
    }
  }

  if (!passwordSelector) {
    throw new Error('Could not find password input field');
  }

  // Get password from account (decrypt if stored)
  let password = null;
  if (account.password) {
    try {
      password = decryptPassword(account.password);
      logger.info(`Using stored password for ${account.username}`);
    } catch (error) {
      logger.error(`Failed to decrypt password for ${account.username}:`, error);
      throw new Error('Failed to decrypt password');
    }
  }

  if (!password) {
    logger.warn(`No password stored for ${account.username} - session-based login required`);
    throw new Error('Password not available. Please add password to account or use session-based login.');
  }

  await page.fill(passwordSelector, password);
  await saveLogToDB(account.id, 'info', 'Filled in credentials');

  // Try to click login button
  let loginClicked = false;
  for (const selector of INSTAGRAM_SELECTORS.LOGIN_BUTTON) {
    try {
      await page.waitForSelector(selector, { timeout: 3000 });
      await page.click(selector);
      loginClicked = true;
      break;
    } catch (e) {
      // Try next selector
    }
  }

  if (!loginClicked) {
    // Try text-based click
    try {
      await page.click('text=Log in', { timeout: 3000 });
      loginClicked = true;
    } catch (e) {
      throw new Error('Could not find or click login button');
    }
  }

  // Wait for navigation away from login page
  await page.waitForURL((url) => !url.href.includes('/accounts/login/'), { timeout: 30000 });

  logger.info(`Successfully logged in: ${account.username}`);
  await saveLogToDB(account.id, 'info', `Successfully logged in to Instagram`);
}

/**
 * Scroll and collect reels
 */
async function collectReels(page, account) {
  logger.info(`Collecting reels for account: ${account.username}`);
  await saveLogToDB(account.id, 'info', 'Starting to collect reels');

  // Navigate to reels
  // Use 'load' instead of 'networkidle' as Instagram has continuous network activity
  await page.goto('https://www.instagram.com/reels/', {
    waitUntil: 'load',
    timeout: 60000 // Increase timeout to 60 seconds
  });
  
  // Wait a bit for content to load
  await page.waitForTimeout(3000);
  await saveLogToDB(account.id, 'info', 'Navigated to reels page');

  const reels = [];
  let scrollCount = 0;
  const maxScrolls = 50; // Limit scrolling

  while (scrollCount < maxScrolls) {
    // Check if account should still be running
    const currentAccount = await prisma.account.findUnique({
      where: { id: account.id }
    });

    if (currentAccount?.status !== ACCOUNT_STATUS.RUNNING) {
      logger.info(`Account ${account.id} status changed, stopping reel collection`);
      break;
    }

    // Wait for reels to load
    await page.waitForTimeout(2000);

    // Extract reel data from current view
    const reelData = await page.evaluate(() => {
      const reels = [];
      // This is a simplified version - you'd need to implement actual reel detection
      // Look for video elements, extract URLs, views, etc.
      const videoElements = document.querySelectorAll('video');
      
      videoElements.forEach((video, index) => {
        const container = video.closest('article') || video.closest('div[role="button"]');
        if (container) {
          // Extract reel URL, views, etc. (simplified)
          const url = window.location.href;
          reels.push({
            url,
            index
          });
        }
      });

      return reels;
    });

    // Process and save reels
    for (const reel of reelData) {
      // Check if reel already exists
      const existing = await prisma.reel.findFirst({
        where: {
          accountId: account.id,
          reelUrl: reel.url
        }
      });

      if (!existing) {
        // Filter reels based on criteria
        if (reel.views >= REEL_FILTERS.MIN_VIEWS && !reel.isAd && !reel.isLive) {
          await prisma.reel.create({
            data: {
              accountId: account.id,
              reelUrl: reel.url,
              views: reel.views || 0,
              isAd: reel.isAd || false,
              isLive: reel.isLive || false
            }
          });

          reels.push(reel);
          logger.info(`Saved reel: ${reel.url} (${reel.views} views)`);
          await saveLogToDB(account.id, 'info', `Saved reel: ${reel.url.substring(0, 50)}... (${reel.views} views)`);
        }
      }
    }

    // Scroll down
    await page.evaluate(() => {
      window.scrollBy(0, window.innerHeight);
    });

    scrollCount++;
    await page.waitForTimeout(1000);
  }

  logger.info(`Collected ${reels.length} reels for account: ${account.username}`);
  await saveLogToDB(account.id, 'info', `Collected ${reels.length} reels`);
  return reels;
}

/**
 * Send DM to user
 */
async function sendDM(page, targetUser, message) {
  logger.info(`Sending DM to ${targetUser}`);

  // Navigate to user profile
  await page.goto(`https://www.instagram.com/${targetUser}/`, {
    waitUntil: 'networkidle'
  });

  // Click message button
  try {
    await page.click('text=Message', { timeout: 5000 });
    await page.waitForTimeout(2000);

    // Type message
    const messageInput = await page.waitForSelector('textarea[placeholder*="Message"]', { timeout: 5000 });
    await messageInput.fill(message);

    // Send message
    await page.click('button:has-text("Send")', { timeout: 5000 });
    await page.waitForTimeout(1000);

    logger.info(`DM sent to ${targetUser}`);
    return true;
  } catch (error) {
    logger.error(`Failed to send DM to ${targetUser}:`, error);
    return false;
  }
}

/**
 * Main bot function
 */
export async function runPlaywrightBot(account) {
  let browser = null;
  let context = null;
  let page = null;

  try {
    logger.info(`Starting bot for account: ${account.username} (ID: ${account.id})`);
    await saveLogToDB(account.id, 'info', 'Bot started');

    // Initialize display and VNC server for this account
    const { display, vncPort } = await initializeDisplayForAccount(account.id);
    const displayEnv = `:${display}`;
    logger.info(`Account ${account.username} using display ${displayEnv}, VNC port ${vncPort}`);
    await saveLogToDB(account.id, 'info', `Using display ${displayEnv}, VNC port ${vncPort}`);

    // Launch browser
    // Use system Chrome (installed in Docker) for better video support
    // Each account uses its own virtual display for separate VNC viewing
    const launchOptions = {
      headless: config.PLAYWRIGHT_HEADLESS, // Already converted to boolean in config
      channel: 'chrome', // Use system Chrome for better video playback
      env: {
        DISPLAY: displayEnv // Set display for this account's browser
      },
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--no-sandbox',
        '--disable-features=IsolateOrigins,site-per-process',
        '--autoplay-policy=no-user-gesture-required',
        '--disable-web-security',
        '--disable-site-isolation-trials'
      ]
    };

    // Add proxy if available
    const proxy = account.proxy || getProxyForAccount(account.id);
    if (proxy) {
      launchOptions.proxy = { server: proxy };
    }

    browser = await chromium.launch(launchOptions);
    await saveLogToDB(account.id, 'info', 'Browser launched');

    // Create context
    context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });

    // Load session if exists
    if (sessionExists(account.id)) {
      const sessionData = loadSession(account.id);
      if (sessionData) {
        await context.addCookies(sessionData.cookies || []);
        logger.info(`Loaded session for account: ${account.username}`);
        await saveLogToDB(account.id, 'info', 'Loaded saved session');
      }
    }

    page = await context.newPage();
    await setupStealthMode(page);

    // Login if no session
    if (!sessionExists(account.id)) {
      await loginToInstagram(page, account);
      // Save session
      const cookies = await context.cookies();
      saveSession(account.id, { cookies });
      await saveLogToDB(account.id, 'info', 'Session saved');
    } else {
      // Navigate to home to verify session
      await page.goto('https://www.instagram.com/', { waitUntil: 'networkidle' });
      
      // Check if logged in
      const isLoggedIn = await page.evaluate(() => {
        return !document.querySelector('input[name="username"]');
      });

      if (!isLoggedIn) {
        logger.warn(`Session expired for ${account.username}, logging in again`);
        await saveLogToDB(account.id, 'warn', 'Session expired, re-logging in');
        await loginToInstagram(page, account);
        const cookies = await context.cookies();
        saveSession(account.id, { cookies });
        await saveLogToDB(account.id, 'info', 'New session saved');
      } else {
        await saveLogToDB(account.id, 'info', 'Session is valid, logged in');
      }
    }

    // Collect reels
    const reels = await collectReels(page, account);

    // Process outreach for collected reels
    const reelsToProcess = await prisma.reel.findMany({
      where: {
        accountId: account.id,
        views: { gte: REEL_FILTERS.MIN_VIEWS },
        isAd: false,
        isLive: false,
        outreach: { none: {} } // No outreach yet
      },
      take: 10
    });

    let outreachCount = 0;
    for (const reel of reelsToProcess) {
      // Extract users from reel (simplified - you'd implement actual extraction)
      // For now, this is a placeholder
      const targetUsers = []; // Extract from reel comments/engagement

      for (const user of targetUsers) {
        const message = `Hi ${user}! I saw your engagement on this reel...`;
        const sent = await sendDM(page, user, message);

        await prisma.outreach.create({
          data: {
            reelId: reel.id,
            targetUser: user,
            message,
            sent,
            ...(sent && { sentAt: new Date() })
          }
        });

        if (sent) {
          outreachCount++;
        }

        // Rate limiting
        await page.waitForTimeout(5000);
      }
    }

    // Save final session state
    const cookies = await context.cookies();
    saveSession(account.id, { cookies });

    logger.info(`Bot completed for account: ${account.username}`);
    logger.info(`- Reels collected: ${reels.length}`);
    logger.info(`- Outreach sent: ${outreachCount}`);
    await saveLogToDB(account.id, 'info', `Bot completed: ${reels.length} reels collected, ${outreachCount} outreach sent`);

    return {
      success: true,
      reelsCollected: reels.length,
      outreachSent: outreachCount
    };
  } catch (error) {
    logger.error(`Bot error for account ${account.username}:`, error);
    await saveLogToDB(account.id, 'error', `Bot error: ${error.message}`);
    throw error;
  } finally {
    if (page) await page.close();
    if (context) await context.close();
    if (browser) await browser.close();
  }
}

