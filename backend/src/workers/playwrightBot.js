import { chromium } from 'playwright';
import prisma from '../db/prisma.js';
import { logger } from '../utils/logger.js';
import { loadSession, saveSession, sessionExists } from '../utils/sessionManager.js';
import { getProxyForAccount } from '../utils/proxyManager.js';
import { config } from '../config/env.js';
import { INSTAGRAM_SELECTORS, REEL_FILTERS, ACCOUNT_STATUS, INSTAGRAM_REEL_SELECTORS } from '../config/constants.js';
import { decryptPassword } from '../utils/encryption.js';
import { saveLogToDB } from '../utils/dbLogger.js';
import { getDisplayEnv, getVncPort, initializeDisplayForAccount } from '../utils/displayManager.js';
import { generateOutreachMessage } from '../utils/openaiClient.js';

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
 * Parse likes count from text (e.g., "8M" -> 8000000, "100K" -> 100000)
 */
function parseLikesCount(text) {
  if (!text) return 0;
  
  const cleanText = text.trim().toUpperCase();
  const match = cleanText.match(/^([\d.]+)([KM])?$/);
  
  if (!match) return 0;
  
  const number = parseFloat(match[1]);
  const suffix = match[2];
  
  if (suffix === 'M') {
    return Math.floor(number * 1000000);
  } else if (suffix === 'K') {
    return Math.floor(number * 1000);
  }
  
  return Math.floor(number);
}

/**
 * Extract reel information from current view
 * Based on HTML structure provided:
 * - Like count: <span class="...">8M</span> in like button area
 * - Username: <span class="...">clarazrd</span> in a link
 */
async function extractCurrentReelInfo(page) {
  return await page.evaluate(() => {
    // Find the like count - look for span with "M" or "K" next to the like button
    // Based on HTML: <span class="...">8M</span> in the like button container
    let likesText = null;
    
    // Method 1: Look for the like button SVG first
    const likeButtons = Array.from(document.querySelectorAll('svg[aria-label="Like"]'));
    if (likeButtons.length > 0) {
      // Find the closest parent that might contain the count
      for (const likeSvg of likeButtons) {
        // Go up the DOM tree to find the container
        let current = likeSvg.closest('div');
        let depth = 0;
        while (current && depth < 5) {
          // Look for spans with M/K in this container
          const spans = current.querySelectorAll('span[dir="auto"]');
          for (const span of spans) {
            const text = span.textContent.trim();
            // Match patterns like "8M", "100K", "1.5M", etc.
            if (text.match(/^[\d.]+[KM]$/)) {
              likesText = text;
              break;
            }
          }
          if (likesText) break;
          current = current.parentElement;
          depth++;
        }
        if (likesText) break;
      }
    }
    
    // Method 2: Search all spans for like counts (broader search)
    if (!likesText) {
      const allSpans = document.querySelectorAll('span[dir="auto"]');
      for (const span of allSpans) {
        const text = span.textContent.trim();
        // Match patterns like "8M", "100K", "1.5M", etc.
        if (text.match(/^[\d.]+[KM]$/)) {
          // Check if it's near a like button (within reasonable distance)
          const likeButton = span.closest('article')?.querySelector('svg[aria-label="Like"]');
          if (likeButton) {
            likesText = text;
            break;
          }
        }
      }
    }
    
    // Method 3: Look for spans that contain numbers with M/K anywhere in the reel area
    if (!likesText) {
      const article = document.querySelector('article');
      if (article) {
        const spans = article.querySelectorAll('span');
        for (const span of spans) {
          const text = span.textContent.trim();
          if (text.match(/^[\d.]+[KM]$/)) {
            likesText = text;
            break;
          }
        }
      }
    }
    
    // Find username - look for clickable username link
    // Based on HTML: <span class="...">clarazrd</span> in a link
    let username = null;
    
    // Method 1: Look for links with username spans in the article/reel container
    const article = document.querySelector('article');
    const searchContainer = article || document;
    
    const links = searchContainer.querySelectorAll('a[href^="/"]');
    for (const link of links) {
      const href = link.getAttribute('href');
      // Skip common links
      if (href.match(/^\/(explore|reels|direct|accounts|p\/)/)) continue;
      
      const span = link.querySelector('span[dir="auto"]');
      if (span) {
        const text = span.textContent.trim();
        // Username should not be a number, M/K, or common words
        if (text && 
            !text.match(/^[\d.]+[KM]?$/) && 
            !text.match(/^(Like|Comment|Share|Message|Follow|Following|M|K|View|all|comments)$/i) &&
            text.length > 0 && 
            text.length < 50 &&
            !text.includes(' ')) { // Usernames don't have spaces
          // Check if it's likely a username (alphanumeric, underscores, dots)
          if (text.match(/^[a-zA-Z0-9._]+$/)) {
            // Make sure the href matches the username
            if (href === `/${text}/` || href.startsWith(`/${text}`)) {
              username = text;
              break;
            }
          }
        }
      }
    }
    
    // Method 2: If still not found, look for any link that looks like a profile
    if (!username) {
      for (const link of links) {
        const href = link.getAttribute('href');
        // Profile links are usually /username/ format
        const match = href.match(/^\/([a-zA-Z0-9._]+)\/?$/);
        if (match && match[1] && match[1].length > 1 && match[1].length < 30) {
          const span = link.querySelector('span[dir="auto"]');
          if (span) {
            const text = span.textContent.trim();
            if (text === match[1] || text.includes(match[1])) {
              username = match[1];
              break;
            }
          }
        }
      }
    }
    
    // Get current URL
    const url = window.location.href;
    
    return {
      likesText,
      username,
      url,
      debug: {
        likeButtonsFound: document.querySelectorAll('svg[aria-label="Like"]').length,
        linksFound: links.length,
        articleFound: !!article
      }
    };
  });
}

/**
 * Process outreach for a reel (click username, message, generate, send, close)
 */
async function processReelOutreach(page, account, reelUrl, username) {
  try {
    logger.info(`Processing outreach for user: ${username} from reel: ${reelUrl}`);
    await saveLogToDB(account.id, 'info', `Processing outreach for ${username}`);

    // Step 1: Click username to go to profile
    try {
      // Find and click the username link
      const usernameSelector = `a[href="/${username}/"] span[dir="auto"]`;
      await page.click(usernameSelector, { timeout: 5000 });
      await page.waitForTimeout(2000);
      await saveLogToDB(account.id, 'info', `Clicked username: ${username}`);
    } catch (error) {
      // Try alternative selector
      await page.click(`text=${username}`, { timeout: 5000 });
      await page.waitForTimeout(2000);
    }

    // Step 2: Click Message button
    let messageButtonClicked = false;
    for (const selector of INSTAGRAM_REEL_SELECTORS.MESSAGE_BUTTON) {
      try {
        await page.click(selector, { timeout: 5000 });
        await page.waitForTimeout(2000);
        messageButtonClicked = true;
        await saveLogToDB(account.id, 'info', 'Clicked Message button');
        break;
      } catch (e) {
        // Try next selector
      }
    }

    if (!messageButtonClicked) {
      throw new Error('Could not find Message button');
    }

    // Step 3: Wait for message modal and click contenteditable input
    let inputClicked = false;
    for (const selector of INSTAGRAM_REEL_SELECTORS.MESSAGE_INPUT) {
      try {
        await page.click(selector, { timeout: 5000 });
        await page.waitForTimeout(1000);
        inputClicked = true;
        await saveLogToDB(account.id, 'info', 'Clicked message input');
        break;
      } catch (e) {
        // Try next selector
      }
    }

    if (!inputClicked) {
      throw new Error('Could not find message input');
    }

    // Step 4: Generate message using OpenAI
    // Use the prompt ID from the account
    logger.info(`Account prompt ID: ${account.openaiPromptId || 'NOT SET!'}`);
    await saveLogToDB(account.id, 'info', `Using prompt ID: ${account.openaiPromptId || 'NOT SET!'}`);
    
    if (!account.openaiPromptId || account.openaiPromptId.trim() === '') {
      throw new Error(`No OpenAI prompt ID configured for account ${account.username} (ID: ${account.id}). Please set it in the account settings.`);
    }
    
    logger.info(`Calling generateOutreachMessage with prompt ID: ${account.openaiPromptId}`);
    const generatedMessage = await generateOutreachMessage(account.openaiPromptId, username);
    await saveLogToDB(account.id, 'info', `Generated message: ${generatedMessage.substring(0, 50)}...`);

    // Step 5: Type and send message
    // Use evaluate() to set the text content directly in the contenteditable div
    // This ensures the entire message is set at once, preventing splitting
    let messageSet = false;
    for (const selector of INSTAGRAM_REEL_SELECTORS.MESSAGE_INPUT) {
      try {
        // Click the input first to focus it
        await page.click(selector, { timeout: 5000 });
        await page.waitForTimeout(300);
        
        // Use evaluate to set the innerText directly - this prevents splitting
        await page.evaluate((sel, msg) => {
          const element = document.querySelector(sel);
          if (element) {
            // Clear existing content
            element.innerHTML = '';
            // Set the text content directly
            element.innerText = msg;
            // Trigger input event so Instagram recognizes the change
            const event = new Event('input', { bubbles: true });
            element.dispatchEvent(event);
          }
        }, selector, generatedMessage);
        
        await page.waitForTimeout(500);
        messageSet = true;
        await saveLogToDB(account.id, 'info', 'Message text set in input field');
        break;
      } catch (e) {
        logger.warn(`Could not set message using selector ${selector}:`, e.message);
        // Try next selector
      }
    }
    
    // Fallback to fill() if evaluate() didn't work
    if (!messageSet) {
      try {
        for (const selector of INSTAGRAM_REEL_SELECTORS.MESSAGE_INPUT) {
          try {
            const input = await page.locator(selector).first();
            await input.click();
            await input.fill(generatedMessage);
            await page.waitForTimeout(500);
            messageSet = true;
            break;
          } catch (e) {
            // Try next selector
          }
        }
      } catch (e) {
        logger.warn('Could not use fill(), falling back to keyboard typing');
      }
    }
    
    // Last resort: keyboard typing (but this might cause splitting)
    if (!messageSet) {
      logger.warn('Using keyboard typing as last resort - message might split');
      await page.keyboard.type(generatedMessage, { delay: 20 });
    }
    
    await page.waitForTimeout(1000);

    // Click Send button
    let sent = false;
    for (const selector of INSTAGRAM_REEL_SELECTORS.SEND_BUTTON) {
      try {
        await page.click(selector, { timeout: 5000 });
        await page.waitForTimeout(2000);
        sent = true;
        await saveLogToDB(account.id, 'info', 'Message sent');
        break;
      } catch (e) {
        // Try next selector
      }
    }

    // If send button not found, try pressing Enter
    if (!sent) {
      await page.keyboard.press('Enter');
      await page.waitForTimeout(2000);
      sent = true;
      await saveLogToDB(account.id, 'info', 'Message sent (via Enter key)');
    }

    // Step 6: Close the message modal
    // Click the close button (X icon)
    let closed = false;
    for (const selector of INSTAGRAM_REEL_SELECTORS.CLOSE_BUTTON) {
      try {
        // Try clicking the parent button that contains the SVG
        if (selector.includes('svg')) {
          // If selector is for SVG, try clicking the parent button
          await page.click(selector, { timeout: 5000 });
        } else {
          await page.click(selector, { timeout: 5000 });
        }
        await page.waitForTimeout(1000);
        closed = true;
        await saveLogToDB(account.id, 'info', 'Closed message modal');
        break;
      } catch (e) {
        // Try next selector
      }
    }
    
    // If close button not found, try pressing Escape key
    if (!closed) {
      try {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(1000);
        closed = true;
        await saveLogToDB(account.id, 'info', 'Closed message modal with Escape key');
      } catch (e) {
        logger.warn('Could not close message modal');
      }
    }

    // Step 7: Go back to reels page
    await page.goto('https://www.instagram.com/reels/', {
      waitUntil: 'load',
      timeout: 60000
    });
    await page.waitForTimeout(2000);
    await saveLogToDB(account.id, 'info', 'Returned to reels page');

    // Save outreach to database
    const reel = await prisma.reel.findFirst({
      where: {
        accountId: account.id,
        reelUrl: reelUrl
      }
    });

    if (reel) {
      await prisma.outreach.create({
        data: {
          reelId: reel.id,
          targetUser: username,
          message: generatedMessage,
          sent: sent,
          sentAt: sent ? new Date() : null
        }
      });
    }

    return { success: true, sent };
  } catch (error) {
    logger.error(`Outreach failed for ${username}:`, error);
    await saveLogToDB(account.id, 'error', `Outreach failed for ${username}: ${error.message}`);
    
    // Try to go back to reels page even if outreach failed
    try {
      await page.goto('https://www.instagram.com/reels/', {
        waitUntil: 'load',
        timeout: 60000
      });
    } catch (e) {
      logger.error('Failed to return to reels page:', e);
    }
    
    return { success: false, error: error.message };
  }
}

/**
 * Scroll and collect reels, processing outreach inline
 */
async function collectReels(page, account) {
  logger.info(`Collecting reels for account: ${account.username}`);
  await saveLogToDB(account.id, 'info', 'Starting to collect reels');

  // Navigate to reels
  await page.goto('https://www.instagram.com/reels/', {
    waitUntil: 'load',
    timeout: 60000
  });
  
  // Wait for content to load
  await page.waitForTimeout(3000);
  await saveLogToDB(account.id, 'info', 'Navigated to reels page');

  const reels = [];
  let scrollCount = 0;
  const maxScrolls = 50; // Limit scrolling
  let outreachCount = 0;
  let lastReelUrl = null; // Track the last processed reel URL to avoid duplicates
  let lastReelUsername = null; // Track the last processed username

  logger.info(`Starting reel collection loop (max ${maxScrolls} scrolls)`);
  await saveLogToDB(account.id, 'info', `Starting reel collection loop (max ${maxScrolls} scrolls)`);

  try {
    while (scrollCount < maxScrolls) {
    logger.info(`Loop iteration ${scrollCount + 1}/${maxScrolls}`);
    await saveLogToDB(account.id, 'info', `Processing reel ${scrollCount + 1}/${maxScrolls}`);
    
    // Check if account should still be running
    const currentAccount = await prisma.account.findUnique({
      where: { id: account.id }
    });

    if (currentAccount?.status !== ACCOUNT_STATUS.RUNNING) {
      logger.info(`Account ${account.id} status changed to ${currentAccount?.status}, stopping reel collection`);
      await saveLogToDB(account.id, 'info', `Account status changed, stopping collection`);
      break;
    }

    // Wait for reel to load
    logger.info(`Waiting for reel to load...`);
    await page.waitForTimeout(3000); // Increased wait time for reels to fully load

    // Extract current reel information
    logger.info(`Extracting reel information...`);
    const reelInfo = await extractCurrentReelInfo(page);
    
    // Check if this is the same reel as the last one (scroll didn't work)
    if (reelInfo.url === lastReelUrl && reelInfo.username === lastReelUsername) {
      logger.warn(`Same reel detected (${reelInfo.username}), scrolling again...`);
      await saveLogToDB(account.id, 'warn', `Same reel detected, attempting to scroll again`);
      
      // Try more aggressive scrolling
      await page.evaluate(() => {
        window.scrollBy(0, window.innerHeight * 2); // Scroll 2 viewport heights
      });
      await page.waitForTimeout(1000);
      
      // Try arrow down multiple times
      for (let i = 0; i < 3; i++) {
        await page.keyboard.press('ArrowDown');
        await page.waitForTimeout(500);
      }
      
      await page.waitForTimeout(2000); // Wait longer for new reel to load
      
      // Re-extract to see if we got a new reel
      const newReelInfo = await extractCurrentReelInfo(page);
      if (newReelInfo.url === lastReelUrl && newReelInfo.username === lastReelUsername) {
        logger.warn(`Still on same reel after aggressive scroll, skipping this iteration`);
        await saveLogToDB(account.id, 'warn', `Still on same reel, skipping`);
        scrollCount++;
        continue; // Skip this iteration and try again
      } else {
        // We got a new reel, use it
        reelInfo.url = newReelInfo.url;
        reelInfo.username = newReelInfo.username;
        reelInfo.likesText = newReelInfo.likesText;
      }
    }
    
    logger.info(`Extracted reel info - Likes: ${reelInfo.likesText || 'not found'}, Username: ${reelInfo.username || 'not found'}, URL: ${reelInfo.url}`);
    await saveLogToDB(account.id, 'info', `Checking reel - Likes: ${reelInfo.likesText || 'N/A'}, User: ${reelInfo.username || 'N/A'}`);
    
    if (reelInfo.likesText && reelInfo.username) {
      const likes = parseLikesCount(reelInfo.likesText);
      logger.info(`Current reel: ${reelInfo.username}, Likes: ${likes} (${reelInfo.likesText})`);
      await saveLogToDB(account.id, 'info', `Found reel: @${reelInfo.username} with ${likes} likes`);
      
      // Check if reel already exists in database
      const existingReel = await prisma.reel.findFirst({
        where: {
          accountId: account.id,
          reelUrl: reelInfo.url
        }
      });

      // Save reel to database if not exists
      let reel;
      if (!existingReel) {
        reel = await prisma.reel.create({
          data: {
            accountId: account.id,
            reelUrl: reelInfo.url,
            views: likes, 
            isAd: false,
            isLive: false
          }
        });
        reels.push(reel);
        logger.info(`Saved new reel: ${reelInfo.url}`);
        await saveLogToDB(account.id, 'info', `Saved reel: @${reelInfo.username} (${likes} likes)`);
      } else {
        reel = existingReel;
        logger.info(`Reel already exists in database: ${reelInfo.url}`);
      }

      // Check if likes >= 100k and process outreach
      if (likes >= REEL_FILTERS.MIN_LIKES) {
        logger.info(`Reel has ${likes} likes (>= ${REEL_FILTERS.MIN_LIKES}), checking for existing outreach`);
        await saveLogToDB(account.id, 'info', `Reel qualifies for outreach: ${likes} likes >= ${REEL_FILTERS.MIN_LIKES}`);
        
        // Check if we already sent outreach for this reel/user
        const existingOutreach = await prisma.outreach.findFirst({
          where: {
            reelId: reel.id,
            targetUser: reelInfo.username
          }
        });

        if (!existingOutreach) {
          logger.info(`Reel has ${likes} likes (>= 100k), processing outreach for ${reelInfo.username}`);
          await saveLogToDB(account.id, 'info', `Processing outreach for @${reelInfo.username} (${likes} likes)`);
          
          const result = await processReelOutreach(page, account, reelInfo.url, reelInfo.username);
          
          if (result.success && result.sent) {
            outreachCount++;
            await saveLogToDB(account.id, 'info', `Successfully sent outreach to @${reelInfo.username}`);
          } else {
            await saveLogToDB(account.id, 'warn', `Failed to send outreach to @${reelInfo.username}: ${result.error || 'Unknown error'}`);
          }
          
          // Rate limiting between outreach attempts
          await page.waitForTimeout(3000);
        } else {
          logger.info(`Outreach already sent to ${reelInfo.username} for this reel`);
          await saveLogToDB(account.id, 'info', `Outreach already sent to @${reelInfo.username} for this reel`);
        }
      } else {
        logger.info(`Reel has ${likes} likes (< ${REEL_FILTERS.MIN_LIKES}), skipping outreach`);
        await saveLogToDB(account.id, 'info', `Reel below threshold: ${likes} likes < ${REEL_FILTERS.MIN_LIKES}`);
      }
    } else {
      logger.warn(`Could not extract reel info - Missing: ${!reelInfo.likesText ? 'likes' : ''} ${!reelInfo.username ? 'username' : ''}`);
      await saveLogToDB(account.id, 'warn', `Could not extract reel data - Missing: ${!reelInfo.likesText ? 'likes' : ''} ${!reelInfo.username ? 'username' : ''}`);
    }

    // Update last processed reel info
    if (reelInfo.url && reelInfo.username) {
      lastReelUrl = reelInfo.url;
      lastReelUsername = reelInfo.username;
    }

    // Scroll down to next reel
    // Try multiple scroll methods to ensure we move to the next reel
    logger.info(`Scrolling to next reel...`);
    await page.evaluate(() => {
      // Method 1: Scroll by viewport height
      window.scrollBy(0, window.innerHeight);
    });
    await page.waitForTimeout(500);
    
    // Method 2: Try scrolling the reel container if it exists
    try {
      await page.evaluate(() => {
        const reelContainer = document.querySelector('div[role="main"]') || 
                             document.querySelector('main') ||
                             document.querySelector('article')?.parentElement;
        if (reelContainer) {
          reelContainer.scrollBy(0, window.innerHeight);
        }
      });
    } catch (e) {
      // Ignore if scroll fails
    }
    
    await page.waitForTimeout(500);
    
    // Method 3: Press arrow down key to navigate to next reel (Instagram Reels uses this)
    try {
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(1000); // Wait longer for reel to change
    } catch (e) {
      // Ignore if key press fails
    }

    scrollCount++;
    logger.info(`Scrolled to next reel (scroll ${scrollCount}/${maxScrolls})`);
    await saveLogToDB(account.id, 'info', `Scrolled to reel ${scrollCount}/${maxScrolls}`);
    
    // Wait for the new reel to load before next iteration
    await page.waitForTimeout(2000);
    }
  } catch (error) {
    logger.error(`Error in reel collection loop:`, error);
    await saveLogToDB(account.id, 'error', `Error in reel collection: ${error.message}`);
    throw error;
  }

  logger.info(`Collected ${reels.length} reels, sent ${outreachCount} outreach messages`);
  await saveLogToDB(account.id, 'info', `Collected ${reels.length} reels, sent ${outreachCount} outreach messages`);
  return { reels, outreachCount };
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

    // Collect reels and process outreach inline
    const { reels, outreachCount } = await collectReels(page, account);

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

