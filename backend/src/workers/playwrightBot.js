import { chromium } from 'playwright';
import prisma from '../db/prisma.js';
import { logger } from '../utils/logger.js';
import { loadSession, saveSession, sessionExists } from '../utils/sessionManager.js';
import { getProxyForAccount } from '../utils/proxyManager.js';
import { config } from '../config/env.js';
import { INSTAGRAM_SELECTORS, REEL_FILTERS, ACCOUNT_STATUS, INSTAGRAM_REEL_SELECTORS } from '../config/constants.js';
import { decryptPassword } from '../utils/encryption.js';
import { saveLogToDB } from '../utils/dbLogger.js';
import { initializeDisplayForAccount } from '../utils/displayManager.js';

/*
  Full rewrite of the Instagram Reels automation file.

  - Robust extraction of like counts that does NOT rely on fragile class names
  - Reliable scrolling by finding the next <article> element and scrolling it into view
  - Better retry and verification logic so the bot does not "snap back" to the first reel
  - Clear logging and conservative wait times
  - Re-uses existing utility functions (prisma, saveLogToDB, etc.)
*/

async function setupStealthMode(page) {
  await page.addInitScript(() => {
    try {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    } catch (e) {}

    try {
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    } catch (e) {}

    try {
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    } catch (e) {}

    // permissions override
    try {
      const orig = navigator.permissions?.query;
      if (orig) {
        navigator.permissions.query = (params) =>
          params && params.name === 'notifications'
            ? Promise.resolve({ state: Notification.permission })
            : orig(params);
      }
    } catch (e) {}
  });
}

async function loginToInstagram(page, account) {
  await saveLogToDB(account.id, 'info', `Starting login for ${account.username}`);
  await page.goto('https://www.instagram.com/accounts/login/', { waitUntil: 'load', timeout: 60000 });

  // Fill username
  let usernameSelector = null;
  for (const s of INSTAGRAM_SELECTORS.USERNAME) {
    try {
      await page.waitForSelector(s, { timeout: 3000 });
      usernameSelector = s;
      break;
    } catch (e) {}
  }
  if (!usernameSelector) throw new Error('Could not find username input');
  await page.fill(usernameSelector, account.username);

  // Fill password
  let passwordSelector = null;
  for (const s of INSTAGRAM_SELECTORS.PASSWORD) {
    try {
      await page.waitForSelector(s, { timeout: 3000 });
      passwordSelector = s;
      break;
    } catch (e) {}
  }
  if (!passwordSelector) throw new Error('Could not find password input');

  let password = null;
  if (account.password) {
    password = decryptPassword(account.password);
  }
  if (!password) throw new Error('Password not available');
  await page.fill(passwordSelector, password);
  await saveLogToDB(account.id, 'info', 'Filled in credentials');

  // Click login button - try multiple methods
  let clicked = false;
  
  // Method 1: Try selectors
  for (const s of INSTAGRAM_SELECTORS.LOGIN_BUTTON) {
    try {
      await page.waitForSelector(s, { timeout: 2000, state: 'visible' });
      await page.click(s, { timeout: 3000 });
      clicked = true;
      await saveLogToDB(account.id, 'info', `Clicked login button using selector: ${s}`);
      break;
    } catch (e) {}
  }
  
  // Method 2: Try text selector
  if (!clicked) {
    try {
      await page.click('text=Log in', { timeout: 3000 });
      clicked = true;
      await saveLogToDB(account.id, 'info', 'Clicked login button using text selector');
    } catch (e) {}
  }
  
  // Method 3: Try pressing Enter in password field
  if (!clicked) {
    try {
      await page.focus(passwordSelector);
      await page.keyboard.press('Enter');
      clicked = true;
      await saveLogToDB(account.id, 'info', 'Pressed Enter in password field to login');
    } catch (e) {}
  }
  
  if (!clicked) {
    await saveLogToDB(account.id, 'error', 'Could not click login button or press Enter');
    throw new Error('Could not click login');
  }

  // Wait a moment for the click to register
  await page.waitForTimeout(1000);

  // Wait for navigation after login click
  await saveLogToDB(account.id, 'info', 'Waiting for login to complete...');
  
  try {
    // Wait for navigation away from login page (up to 45 seconds - Instagram can be slow)
    await page.waitForURL((url) => !url.includes('/accounts/login/'), { 
      timeout: 45000,
      waitUntil: 'load'
    });
    await saveLogToDB(account.id, 'info', 'Successfully navigated away from login page');
  } catch (e) {
    // If navigation didn't happen, wait a bit and check
    await page.waitForTimeout(3000);
    
    // Check current URL first
    const cur = page.url();
    
    // If we're not on login page, login succeeded
    if (!cur.includes('/accounts/login/')) {
      await saveLogToDB(account.id, 'info', 'Navigated away from login page');
      // Continue to popup handling
    } else {
      // Still on login page - check for specific error messages
      const errorInfo = await page.evaluate(() => {
        // Look for specific error message elements/classes
        const errorSelectors = [
          '[role="alert"]',
          '[id*="error"]',
          '[class*="error"]',
          'div:has-text("Sorry")',
          'div:has-text("incorrect password")',
          'div:has-text("incorrect username")',
          'div:has-text("try again")'
        ];
        
        for (const selector of errorSelectors) {
          try {
            const el = document.querySelector(selector);
            if (el && el.offsetParent !== null) { // Element is visible
              return { hasError: true, errorText: el.textContent.trim().substring(0, 100) };
            }
          } catch (e) {}
        }
        
        // Check for specific error text patterns in visible elements
        const allText = document.body.innerText.toLowerCase();
        const errorPatterns = [
          'sorry, your password was incorrect',
          'the username you entered',
          'we couldn\'t connect',
          'please wait a few minutes'
        ];
        
        for (const pattern of errorPatterns) {
          if (allText.includes(pattern)) {
            return { hasError: true, errorText: pattern };
          }
        }
        
        return { hasError: false };
      });
      
      if (errorInfo.hasError) {
        await saveLogToDB(account.id, 'error', `Login page shows error: ${errorInfo.errorText || 'unknown error'}`);
        throw new Error(`Login failed - ${errorInfo.errorText || 'error message detected'}`);
      }
      
      // No specific error found, but still on login page - check for challenges or other issues
      const pageInfo = await page.evaluate(() => {
        const bodyText = document.body.textContent.toLowerCase();
        return {
          url: window.location.href,
          title: document.title,
          hasChallenge: bodyText.includes('challenge') || 
                       bodyText.includes('verify') ||
                       bodyText.includes('suspicious') ||
                       bodyText.includes('confirm it\'s you') ||
                       window.location.href.includes('/challenge/'),
          hasLoginForm: !!document.querySelector('input[name="username"]') || 
                       !!document.querySelector('input[type="text"]'),
          hasPasswordField: !!document.querySelector('input[type="password"]'),
          buttonText: Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim()).filter(t => t).join(', '),
          pageText: bodyText.substring(0, 200) // First 200 chars for debugging
        };
      });
      
      await saveLogToDB(account.id, 'warn', `Still on login page. URL: ${pageInfo.url}, Has challenge: ${pageInfo.hasChallenge}, Has form: ${pageInfo.hasLoginForm}, Has password: ${pageInfo.hasPasswordField}`);
      
      // Check if URL indicates challenge page
      if (pageInfo.url.includes('/challenge/') || pageInfo.url.includes('/accounts/two_factor/')) {
        await saveLogToDB(account.id, 'error', `Login requires challenge/verification at URL: ${pageInfo.url}`);
        throw new Error('Login requires challenge/verification');
      }
      
      // Only throw challenge error if we're sure it's a challenge (not just slow redirect)
      // If login form is still present, it might just be slow
      if (pageInfo.hasChallenge && !pageInfo.hasLoginForm && !pageInfo.hasPasswordField) {
        await saveLogToDB(account.id, 'error', `Login requires challenge/verification. Page text: ${pageInfo.pageText}`);
        throw new Error('Login requires challenge/verification');
      }
      
      // Wait a bit more and check URL one more time
      await page.waitForTimeout(5000);
      const finalCheck = page.url();
      if (!finalCheck.includes('/accounts/login/')) {
        await saveLogToDB(account.id, 'info', 'Finally navigated away from login page after additional wait');
        // Continue to popup handling
      } else {
        await saveLogToDB(account.id, 'error', 'Still on login page after extended wait');
        throw new Error('Still on login page after login attempt');
      }
    }
  }

  // Wait a bit more for page to fully load
  await page.waitForTimeout(1500);
  
  // Handle post-login popups (Save login info, Turn on notifications, etc.)
  try {
    await handlePostLoginPopups(page, account.id);
  } catch (e) {
    // Continue even if popup handling fails
  }

  const cur = page.url();
  if (cur.includes('/challenge/') || cur.includes('/accounts/two_factor/')) {
    await saveLogToDB(account.id, 'warn', 'Login requires verification/challenge');
    throw new Error('Login requires verification');
  }

  if (cur.includes('/accounts/login/')) {
    await saveLogToDB(account.id, 'error', 'Still on login page after login attempt');
    throw new Error('Still on login page after login attempt');
  }

  await saveLogToDB(account.id, 'info', 'Login appears successful');
}

async function handlePostLoginPopups(page, accountId) {
  // Dismiss "Save login info" popup
  try {
    const notNowButtons = [
      'button:has-text("Not Now")',
      'button:has-text("Not now")',
      'button[type="button"]:has-text("Not Now")',
      'div[role="button"]:has-text("Not Now")'
    ];
    
    for (const selector of notNowButtons) {
      try {
        await page.click(selector, { timeout: 2000 });
        await saveLogToDB(accountId, 'info', 'Dismissed "Save login info" popup');
        await page.waitForTimeout(500);
        break;
      } catch (e) {}
    }
  } catch (e) {}

  // Dismiss "Turn on notifications" popup
  try {
    const notNowButtons = [
      'button:has-text("Not Now")',
      'button:has-text("Not now")',
      'button[type="button"]:has-text("Not Now")'
    ];
    
    for (const selector of notNowButtons) {
      try {
        await page.click(selector, { timeout: 2000 });
        await saveLogToDB(accountId, 'info', 'Dismissed notifications popup');
        await page.waitForTimeout(500);
        break;
      } catch (e) {}
    }
  } catch (e) {}

  // Press Escape to close any remaining modals
  try {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  } catch (e) {}
}

function parseLikesCount(text) {
  if (!text) return 0;
  const t = String(text).trim().toUpperCase();
  // Remove commas like '1,234' -> '1234'
  const clean = t.replace(/,/g, '');
  const m = clean.match(/^([\d,.]+)([KM])?$/i);
  if (!m) return 0;
  const num = parseFloat(m[1]);
  const suf = (m[2] || '').toUpperCase();
  if (suf === 'M') return Math.floor(num * 1_000_000);
  if (suf === 'K') return Math.floor(num * 1_000);
  return Math.floor(num);
}

/**
 * Extract only like count (faster, used to check threshold before extracting username)
 */
async function extractLikesOnly(page, accountId = null) {
  const result = await page.evaluate(() => {
    // Find active video (closest to viewport center)
    const videos = Array.from(document.querySelectorAll('video'));
    const viewportCenter = window.innerHeight / 2;
    let activeVideo = null;
    let minDist = Infinity;
    
    for (const vid of videos) {
      try {
        const rect = vid.getBoundingClientRect();
        if (!rect || rect.width < 10 || rect.height < 10) continue;
        const centerY = rect.top + rect.height / 2;
        const dist = Math.abs(centerY - viewportCenter);
        if (dist < minDist && rect.top < viewportCenter + 300 && rect.bottom > viewportCenter - 300) {
          minDist = dist;
          activeVideo = vid;
        }
      } catch (e) {}
    }
    
    if (!activeVideo) return { likesText: null };
    
    // Find container by walking up from active video - look for a larger container
    // that likely contains the reel UI (username, like button, etc.)
    let container = activeVideo.parentElement;
    let bestContainer = container;
    for (let depth = 0; depth < 15 && container && container !== document.body; depth++) {
      const rect = container.getBoundingClientRect?.();
      if (rect) {
        // Prefer containers that are reasonably sized (likely to contain reel UI)
        if (rect.width > 300 && rect.height > 400) {
          bestContainer = container;
          // Continue looking for even better container (one that contains Like SVG)
          const hasLikeSvg = container.querySelector('svg[aria-label="Like"], svg[aria-label="like"]');
          if (hasLikeSvg) {
            break; // Found a good container with Like SVG
          }
        }
      }
      container = container.parentElement;
    }
    
    container = bestContainer || document.body;
    
    // Extract likesText: Use html-span class (most reliable method)
    let likesText = null;
    
    // Strategy 1: Search near Like SVG first (most reliable - like count is always near the like button)
    try {
      const likeSvgs = Array.from(container.querySelectorAll('svg[aria-label="Like"], svg[aria-label="like"]'));
      for (const svg of likeSvgs) {
        // Search in parent and siblings of the Like SVG
        let current = svg.parentElement;
        for (let i = 0; i < 8 && current && current !== document.body; i++) {
          // Search for html-span in current element
          const htmlSpans = current.querySelectorAll('span.html-span, span[class*="html-span"]');
          for (const span of htmlSpans) {
            const txt = (span.textContent || '').trim();
            // Match like count patterns: "9,326", "57.3K", "1,234", "123K", etc.
            if (/^[\d,.]+\s*[KMkm]?$/.test(txt) && txt.length <= 12 && txt.length >= 1) {
              // Make sure it's not a username or other number
              if (!/^[a-zA-Z]/.test(txt) && !txt.includes('·') && !txt.includes('•')) {
                likesText = txt.replace(/\s+/g, '');
                break;
              }
            }
          }
          if (likesText) break;
          
          // Also check siblings
          if (current.parentElement) {
            const siblings = Array.from(current.parentElement.children);
            for (const sibling of siblings) {
              if (sibling === current) continue;
              const htmlSpans = sibling.querySelectorAll('span.html-span, span[class*="html-span"]');
              for (const span of htmlSpans) {
                const txt = (span.textContent || '').trim();
                if (/^[\d,.]+\s*[KMkm]?$/.test(txt) && txt.length <= 12 && txt.length >= 1) {
                  if (!/^[a-zA-Z]/.test(txt) && !txt.includes('·') && !txt.includes('•')) {
                    likesText = txt.replace(/\s+/g, '');
                    break;
                  }
                }
              }
              if (likesText) break;
            }
          }
          if (likesText) break;
          current = current.parentElement;
        }
        if (likesText) break;
      }
    } catch (e) {}
    
    // Strategy 2: If not found, search entire container for html-span elements (broader search)
    if (!likesText) {
      try {
        const htmlSpans = container.querySelectorAll('span.html-span, span[class*="html-span"]');
        for (const span of htmlSpans) {
          const txt = (span.textContent || '').trim();
          // Match like count patterns
          if (/^[\d,.]+\s*[KMkm]?$/.test(txt) && txt.length <= 12 && txt.length >= 1) {
            // Make sure it's not a username
            if (!/^[a-zA-Z]/.test(txt) && !txt.includes('·') && !txt.includes('•')) {
              // Prefer if there's a Like SVG nearby (within same parent or grandparent)
              const parent = span.parentElement;
              const grandparent = parent?.parentElement;
              const hasLikeNearby = (parent?.querySelector('svg[aria-label="Like"], svg[aria-label="like"]') ||
                                     grandparent?.querySelector('svg[aria-label="Like"], svg[aria-label="like"]'));
              if (hasLikeNearby || !likesText) {
                likesText = txt.replace(/\s+/g, '');
                if (hasLikeNearby) break; // Prefer this one if Like SVG is nearby
              }
            }
          }
        }
      } catch (e) {}
    }
    
    return { likesText: likesText || null };
  });
  
  return result;
}

/**
 * Very robust extractor that does not depend on class names
 * Strategy (inside page.evaluate):
 * - Find the currently visible article element (the reel frame)
 *   * Prefer article that contains a visible video element or large media
 * - Within that article, find the Like svg (aria-label="Like") and then get the nearest text node
 * - If that fails, search for any numeric span within the article that looks like the likes count
 * - Also extract a canonical reel URL if present
 */
// ---------- REPLACE extractCurrentReelInfo WITH THIS ----------
async function extractCurrentReelInfo(page, accountId = null) {
  // Get current URL first to match against
  const currentUrl = page.url();
  const currentReelId = currentUrl.match(/\/reels?\/([^\/?#]+)/)?.[1] || null;
  if (accountId) {
    await saveLogToDB(accountId, 'info', `[EXTRACT] Starting extraction. Current URL: ${currentUrl}, Expected reelId: ${currentReelId || 'none'}`);
  }

  const result = await page.evaluate((expectedReelId) => {
    const logs = [];
    function log(msg) { logs.push(msg); /* console.log('[EXTRACT] ' + msg); */ }

    function isVisible(el) {
      if (!el) return false;
      const rect = el.getBoundingClientRect?.();
      if (!rect) return false;
      return rect.width > 10 && rect.height > 10 && rect.top < window.innerHeight && rect.bottom > 0;
    }

    log(`Window dimensions: ${window.innerWidth}x${window.innerHeight}`);
    log(`Current URL: ${window.location.href}`);

    // Candidate containers
    const articles = Array.from(document.querySelectorAll('article'));
    const divs = Array.from(document.querySelectorAll('div[role="main"] > div > div, div[data-testid], section, main'));
    const allContainers = [...new Set([...articles, ...divs])];
    log(`Found ${articles.length} article elements, ${divs.length} div/section containers, ${allContainers.length} total containers`);

    // Find all videos first
    const videos = Array.from(document.querySelectorAll('video'));
    log(`Found ${videos.length} video elements`);

    let targetContainer = null;
    const viewportCenter = window.innerHeight / 2;
    log(`Viewport center: ${viewportCenter}px`);

    // Find best active video: closest to center and playing
    let activeVideo = null;
    let activeVideoScore = -1;
    const videoInfo = [];

    for (const vid of videos) {
      try {
        const rect = vid.getBoundingClientRect();
        if (!(rect && rect.width && rect.height)) continue;
        if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
        const centerY = rect.top + rect.height / 2;
        const distFromCenter = Math.abs(centerY - viewportCenter);
        let score = 1 / (1 + distFromCenter);
        const isPlaying = vid.readyState >= 2 && !vid.paused;
        if (isPlaying) score *= 2;
        if (rect.top < viewportCenter + 200 && rect.bottom > viewportCenter - 200) score *= 3;
        videoInfo.push({
          top: Math.round(rect.top),
          bottom: Math.round(rect.bottom),
          centerY: Math.round(centerY),
          distFromCenter: Math.round(distFromCenter),
          score: score.toFixed(3),
          isPlaying,
          readyState: vid.readyState,
          paused: vid.paused
        });
        log(`Video: top=${Math.round(rect.top)}, centerY=${Math.round(centerY)}, dist=${Math.round(distFromCenter)}, score=${score.toFixed(3)}, playing=${isPlaying}`);
        if (score > activeVideoScore) { activeVideoScore = score; activeVideo = vid; log(`  -> New active video (score: ${score.toFixed(3)})`); }
      } catch (e) { /* ignore video calc errors */ }
    }

    // If we have an activeVideo, walk up to find the reel container
    // Based on Instagram structure: video -> nested divs -> container with username/like count
    if (activeVideo) {
      log('Active video found, walking up ancestors to find reel container...');
      let parent = activeVideo.parentElement;
      let depth = 0;
      let bestContainer = null;
      let bestScore = 0;
      
      while (parent && parent !== document.body && depth < 20) {
        try {
          const rect = parent.getBoundingClientRect();
          if (!rect) { parent = parent.parentElement; depth++; continue; }
          
          // Check if this parent contains username link and like button (signs of reel container)
          const hasUsernameLink = parent.querySelector('a[href^="/"][href*="/reels/"], a[href^="/"][href*="/reel/"]');
          const hasLikeButton = parent.querySelector('svg[aria-label="Like"], svg[aria-label="like"]');
          const hasVideo = parent.querySelector('video') === activeVideo;
          
          // Score this container based on what it contains
          let score = 0;
          if (hasVideo) score += 10; // Must contain our active video
          if (hasUsernameLink) score += 20; // Has username link
          if (hasLikeButton) score += 20; // Has like button
          if (rect.width > 300 && rect.height > 400) score += 10; // Reasonable size
          if (isVisible(parent)) score += 5; // Visible
          
          if (score > bestScore && score >= 30) { // Must have video + username or like button
            bestScore = score;
            bestContainer = parent;
            log(`Found better container at depth ${depth} (score: ${score}, size: ${Math.round(rect.width)}x${Math.round(rect.height)})`);
          }
        } catch (e) {}
        
        parent = parent.parentElement;
        depth++;
      }
      
      if (bestContainer) {
        targetContainer = bestContainer;
        log(`Selected container with score: ${bestScore}`);
      }
    }

    // Strategy 2: If expectedReelId is provided, search containers for that id
    if (expectedReelId && !targetContainer) {
      log(`Strategy 2: Looking for container matching reelId: ${expectedReelId}`);
      for (let i = 0; i < allContainers.length; i++) {
        const c = allContainers[i];
        try {
          const links = c.querySelectorAll('a[href*="/reel/"], a[href*="/reels/"]');
          for (const link of links) {
            const href = link.getAttribute('href') || '';
            if (href.includes(expectedReelId)) {
              targetContainer = c;
              log(`Strategy 2 matched: Container ${i} contains reelId ${expectedReelId}`);
              break;
            }
          }
        } catch (e) {}
        if (targetContainer) break;
      }
      if (!targetContainer) log(`Strategy 2: No container found matching reelId ${expectedReelId}`);
    }

    // Strategy 3: fallback to first big parent of activeVideo if no other container found
    if (!targetContainer && activeVideo) {
      log('Strategy 3: Fallback - use nearest sizable parent of activeVideo');
      let parent = activeVideo.parentElement;
      let depth = 0;
      while (parent && parent !== document.body && depth < 15) {
        try {
          const rect = parent.getBoundingClientRect();
          if (rect && rect.width > 200 && rect.height > 200 && isVisible(parent)) {
            targetContainer = parent;
            log(`Strategy 3 selected: Container at depth ${depth} (size: ${Math.round(rect.width)}x${Math.round(rect.height)})`);
            break;
          }
        } catch (e) {}
        parent = parent.parentElement;
        depth++;
      }
    }

    // Final fallback: use the document body
    const container = targetContainer || document.body;
    if (targetContainer) log('Using container: Found container (not body)');
    else log('Using container: document.body (no container found)');

    // Extract username - use multiple strategies for reliability
    let username = null;
    try {
      // Strategy 1: Look for span with dir="auto" that contains username
      // This is the most reliable pattern - username is in a span with dir="auto"
      // Check if it's inside a link or near a profile picture
      const spansWithDir = Array.from(container.querySelectorAll('span[dir="auto"]'));
      for (const span of spansWithDir) {
        const txt = (span.textContent || '').trim();
        // Username pattern: alphanumeric with dots/underscores, 2-30 chars, not a number
        if (/^[a-zA-Z0-9._]{2,30}$/.test(txt) && !/^\d+[KMkm]?$/.test(txt) && !txt.includes('·') && !txt.includes('•')) {
          // Check if it's inside a link (most reliable indicator)
          const isInLink = span.closest('a[href^="/"]');
          if (isInLink) {
            const href = isInLink.getAttribute('href') || '';
            // Make sure it's not a like count link or other non-profile link
            if (!href.includes('/reels/audio/') && !href.includes('/explore/') && !href.includes('/direct/')) {
              username = txt;
              log(`Found username via span[dir="auto"] in link: ${username}`);
              break;
            }
          }
          // Also check if it's near a profile picture
          if (!username) {
            const hasProfilePic = span.closest('div')?.querySelector('img[alt*="profile picture"]');
            if (hasProfilePic) {
              username = txt;
              log(`Found username via span[dir="auto"] near profile pic: ${username}`);
              break;
            }
          }
        }
      }
      
      // Strategy 2: Look for aria-label="username reels" pattern
      if (!username) {
        const linksWithAriaLabel = Array.from(container.querySelectorAll('a[aria-label*="reels"]'));
        for (const link of linksWithAriaLabel) {
          const ariaLabel = link.getAttribute('aria-label') || '';
          // Extract username from aria-label like "yazdiab1 reels"
          const match = ariaLabel.match(/^([a-zA-Z0-9._]{2,30})\s+reels$/i);
          if (match) {
            username = match[1];
            log(`Found username via aria-label: ${username}`);
            break;
          }
        }
      }
      
      // Strategy 3: Extract from href="/username/reels/" pattern
      if (!username) {
        const profileLinks = Array.from(container.querySelectorAll('a[href*="/reels/"]'));
        for (const link of profileLinks) {
          const href = link.getAttribute('href') || '';
          // Match /username/reels/ pattern
          const match = href.match(/\/([a-zA-Z0-9._]{2,30})\/reels\//);
          if (match) {
            username = match[1];
            log(`Found username via href reels pattern: ${username}`);
            break;
          }
        }
      }
      
      // Strategy 4: Look for profile link like /username/ (not /username/reels/)
      if (!username) {
        const profileLinks = Array.from(container.querySelectorAll('a[href^="/"]'));
        for (const link of profileLinks) {
          const href = link.getAttribute('href') || '';
          // Skip non-profile patterns
          if (/^\/(explore|reels|direct|accounts|p)\b/.test(href)) continue;
          // Match /username/ but NOT /username/reels/
          const match = href.match(/^\/([a-zA-Z0-9._]{2,30})\/?$/);
          if (match && !href.includes('/reels')) {
            username = match[1];
            log(`Found username via profile link: ${username}`);
            break;
          }
        }
      }
      
      // Strategy 5: Look for span with html-span class containing username (fallback)
      if (!username) {
        const htmlSpans = Array.from(container.querySelectorAll('span.html-span, span[class*="html-span"]'));
        for (const span of htmlSpans) {
          const txt = (span.textContent || '').trim();
          // Username pattern: alphanumeric with dots/underscores, 2-30 chars, not a number
          if (/^[a-zA-Z0-9._]{2,30}$/.test(txt) && !/^\d+[KMkm]?$/.test(txt) && !txt.includes('·') && !txt.includes('•')) {
            // Check if it's near a profile picture or in a link
            const hasProfilePic = span.closest('div')?.querySelector('img[alt*="profile picture"]');
            const isInLink = span.closest('a[href*="/"]');
            if (hasProfilePic || isInLink) {
              username = txt;
              log(`Found username via html-span: ${username}`);
              break;
            }
          }
        }
      }
    } catch (e) {}

    // Extract likesText: Use html-span class (most reliable method)
    let likesText = null;

    // Strategy 1: Search entire container for html-span elements with numeric content
    // This is more reliable than searching only near the Like SVG
    try {
      const htmlSpans = container.querySelectorAll('span.html-span, span[class*="html-span"]');
      for (const span of htmlSpans) {
        const txt = (span.textContent || '').trim();
        // Match like count patterns: "9,326", "57.3K", "1,234", "123K", etc.
        if (/^[\d,.]+\s*[KMkm]?$/.test(txt) && txt.length <= 12 && txt.length >= 1) {
          // Make sure it's not a username or other number (usernames usually have letters)
          if (!/^[a-zA-Z]/.test(txt) && !txt.includes('·') && !txt.includes('•')) {
            // Verify there's a Like SVG in the same container (to ensure it's the like count)
            const hasLikeSvg = container.querySelector('svg[aria-label="Like"], svg[aria-label="like"]');
            if (hasLikeSvg) {
              likesText = txt.replace(/\s+/g, '');
              log(`Found likes via html-span (container scan): ${likesText}`);
              break;
            }
          }
        }
      }
    } catch (e) {}

    // Strategy 2: If not found, search near Like SVG (fallback)
    if (!likesText) {
      try {
        const likeSvgs = Array.from(container.querySelectorAll('svg[aria-label="Like"], svg[aria-label="like"]'));
        for (const svg of likeSvgs) {
          let current = svg.parentElement;
          for (let i = 0; i < 5 && current && current !== container; i++) {
            const htmlSpans = current.querySelectorAll('span.html-span, span[class*="html-span"]');
            for (const span of htmlSpans) {
              const txt = (span.textContent || '').trim();
              if (/^[\d,.]+\s*[KMkm]?$/.test(txt) && txt.length <= 12 && txt.length >= 1) {
                if (!/^[a-zA-Z]/.test(txt) && !txt.includes('·') && !txt.includes('•')) {
                  likesText = txt.replace(/\s+/g, '');
                  log(`Found likes via html-span (near Like SVG): ${likesText}`);
                  break;
                }
              }
            }
            if (likesText) break;
            current = current.parentElement;
          }
          if (likesText) break;
        }
      } catch (e) {}
    }

    // Reel URL and reelId: prioritize current URL, then look for specific reel links
    let reelUrl = window.location.href;
    let reelId = null;
    try {
      // Strategy 1: Extract from current URL (most reliable)
      const urlMatch = window.location.href.match(/\/reels?\/([a-zA-Z0-9_-]+)/);
      if (urlMatch) {
        reelId = urlMatch[1];
        log(`Found reelId from URL: ${reelId}`);
        reelUrl = window.location.href;
      }
      
      // Strategy 2: Look for specific reel link in container (not user's reels page)
      if (!reelId) {
        const reelLinks = Array.from(container.querySelectorAll('a[href*="/reel/"], a[href*="/reels/"]'));
        for (const link of reelLinks) {
          const href = link.getAttribute('href') || '';
          // Skip user's reels page links like /username/reels/
          if (href.match(/\/[a-zA-Z0-9._]+\/reels?\//)) continue;
          // Look for specific reel ID in URL
          const m = href.match(/\/reel\/([a-zA-Z0-9_-]+)/) || href.match(/\/reels\/([a-zA-Z0-9_-]+)/);
          if (m && m[1].length > 5) { // Reel IDs are usually longer
            reelId = m[1];
            reelUrl = href.startsWith('http') ? href : `https://www.instagram.com${href}`;
            log(`Found reelId from link: ${reelId}`);
            break;
          }
        }
      }
    } catch (e) {}

    const uniqueId = reelId ? `${username || 'anon'}_${reelId}` : `${username || 'anon'}_${likesText || 'unknown'}`;

    log(`Final extraction: username=${username || 'null'}, likesText=${likesText || 'null'}, reelId=${reelId || 'null'}, url=${reelUrl || 'null'}, uniqueId=${uniqueId}`);
    log(`Extraction complete. Logs: ${logs.length} entries`);

    return {
      likesText: likesText || null,
      username: username || null,
      url: reelUrl || null,
      uniqueId,
      reelId: reelId || null,
      debug: {
        articlesFound: articles.length,
        usedContainerVisible: !!targetContainer,
        likeSvgsFound: (container && container.querySelectorAll ? container.querySelectorAll('svg[aria-label="Like"], svg[aria-label="like"]').length : 0),
        expectedReelId: expectedReelId || null,
        matchedReelId: reelId || null,
        videoInfo: videoInfo,
        logs: logs
      }
    };
  }, currentReelId);

  // Log the debug info
  if (accountId && result.debug && result.debug.logs) {
    for (const logMsg of result.debug.logs) {
      await saveLogToDB(accountId, 'info', `[EXTRACT] ${logMsg}`);
    }
  }
  if (accountId && result.debug && result.debug.videoInfo) {
    await saveLogToDB(accountId, 'info', `[EXTRACT] Video info: ${JSON.stringify(result.debug.videoInfo)}`);
  }

  return result;
}

/**
 * Wait for DOM to update after scrolling - checks for video src change, username change, etc.
 */
async function waitForReelUpdate(page, accountId, beforeUsername, beforeReelId, timeout = 5000) {
  const startTime = Date.now();
  const usernameStr = beforeUsername ? `@${beforeUsername}` : 'unknown';
  await saveLogToDB(accountId, 'info', `[SCROLL] Waiting for DOM update (before: ${usernameStr}, reelId: ${beforeReelId})`);
  
  while (Date.now() - startTime < timeout) {
    const updated = await page.evaluate(({ expectedOldUsername, expectedOldReelId }) => {
      // Find the active video (closest to viewport center)
      const videos = Array.from(document.querySelectorAll('video'));
      const viewportCenter = window.innerHeight / 2;
      let activeVideo = null;
      let minDist = Infinity;
      
      for (const vid of videos) {
        try {
          const rect = vid.getBoundingClientRect();
          if (!rect || rect.width < 10 || rect.height < 10) continue;
          const centerY = rect.top + rect.height / 2;
          const dist = Math.abs(centerY - viewportCenter);
          if (dist < minDist && rect.top < viewportCenter + 300 && rect.bottom > viewportCenter - 300) {
            minDist = dist;
            activeVideo = vid;
          }
        } catch (e) {}
      }
      
      if (!activeVideo) return { updated: false, reason: 'No active video found' };
      
      // Get video src (blob URL) - should change for new reel
      const videoSrc = activeVideo.src || '';
      
      // Walk up from video to find container with username
      let container = activeVideo.parentElement;
      let username = null;
      let reelId = null;
      
      for (let depth = 0; depth < 15 && container && container !== document.body; depth++) {
        // Look for username link
        const usernameLink = container.querySelector('a[href^="/"][href*="/reels/"], a[href^="/"][href*="/reel/"]');
        if (usernameLink) {
          const href = usernameLink.getAttribute('href') || '';
          // Extract username from href like /username/reels/ or /reels/REELID/
          const userMatch = href.match(/\/([a-zA-Z0-9._]+)\/reels?\//);
          const reelMatch = href.match(/\/reels?\/([a-zA-Z0-9_-]+)/);
          if (userMatch) username = userMatch[1];
          if (reelMatch) reelId = reelMatch[1];
          if (username || reelId) break;
        }
        container = container.parentElement;
      }
      
      // Check if username or reelId changed
      if (username && username !== expectedOldUsername) {
        return { updated: true, reason: 'Username changed', username, reelId, videoSrc: videoSrc.substring(0, 50) };
      }
      if (reelId && reelId !== expectedOldReelId) {
        return { updated: true, reason: 'ReelId changed', username, reelId, videoSrc: videoSrc.substring(0, 50) };
      }
      
      return { updated: false, reason: 'No change detected', username, reelId };
    }, { expectedOldUsername: beforeUsername, expectedOldReelId: beforeReelId });
    
    if (updated.updated) {
      await saveLogToDB(accountId, 'info', `[SCROLL] DOM updated: ${updated.reason} (@${updated.username || 'unknown'}, reelId: ${updated.reelId || 'unknown'})`);
      return true;
    }
    
    await page.waitForTimeout(200);
  }
  
  await saveLogToDB(accountId, 'warn', `[SCROLL] DOM update timeout after ${timeout}ms`);
  return false;
}

async function attemptScrollToNextReel(page, accountId) {
  // Get before state - extract likes and reelId only (faster, doesn't need username)
  const beforeUrl = page.url();
  await saveLogToDB(accountId, 'info', `[SCROLL] BEFORE: URL=${beforeUrl}`);

  // Extract minimal info for scroll verification (likes + reelId, no username needed)
  const beforeLikes = await extractLikesOnly(page, accountId);
  const beforeUrlMatch = beforeUrl.match(/\/reels?\/([^\/?#]+)/);
  const beforeReelId = beforeUrlMatch ? beforeUrlMatch[1] : 'unknown';
  
  // Create a simple identifier from URL reelId + likes (if available)
  const beforeId = beforeReelId !== 'unknown' ? `reel_${beforeReelId}_${beforeLikes.likesText || 'unknown'}` : 'unknown';

  await saveLogToDB(accountId, 'info', `[SCROLL] BEFORE: reelId=${beforeReelId}, likes=${beforeLikes.likesText || 'unknown'}, uniqueId=${beforeId}`);

  if (!beforeId || beforeId === 'unknown' || beforeReelId === 'unknown') {
    await saveLogToDB(accountId, 'warn', '[SCROLL] No before-reelId available - aborting scroll attempt');
    return false;
  }

  await saveLogToDB(accountId, 'info', `[SCROLL] Attempting to scroll from reelId=${beforeReelId}`);

  // Scroll: Press ArrowDown (no need to click video, ArrowDown works on focused page)
  try {
    await saveLogToDB(accountId, 'info', '[SCROLL] Pressing ArrowDown...');
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(300); // Brief wait for scroll to start
  } catch (e) {
    await saveLogToDB(accountId, 'warn', `[SCROLL] Scroll error: ${e.message}`);
  }

  // Wait for URL to change (reelId in URL should change when scrolling to new reel)
  let urlChanged = false;
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(300);
    const currentUrl = page.url();
    const currentReelId = currentUrl.match(/\/reels?\/([^\/?#]+)/)?.[1];
    if (currentReelId && currentReelId !== beforeReelId) {
      await saveLogToDB(accountId, 'info', `[SCROLL] URL changed: ${beforeReelId} -> ${currentReelId}`);
      urlChanged = true;
      break;
    }
  }
  
  // Also wait for DOM to update (video src change, etc.)
  const domUpdated = await waitForReelUpdate(page, accountId, null, beforeReelId, 3000);
  
  // Wait for scroll animation to complete
  await page.waitForTimeout(800);
  
  // Check if URL changed (most reliable indicator of scroll success)
  const afterUrl = page.url();
  const afterUrlMatch = afterUrl.match(/\/reels?\/([^\/?#]+)/);
  const afterReelId = afterUrlMatch ? afterUrlMatch[1] : 'unknown';
  
  if (urlChanged || (afterReelId !== 'unknown' && afterReelId !== beforeReelId)) {
    await saveLogToDB(accountId, 'info', `[SCROLL] ✅ SUCCESS: Scrolled to new reel (reelId: ${beforeReelId} -> ${afterReelId})`);
    return true;
  }
  
  // URL didn't change, but DOM might have updated - check likes to verify
  if (domUpdated) {
    await page.waitForTimeout(500);
    const afterLikes = await extractLikesOnly(page, accountId);
    const afterId = afterReelId !== 'unknown' ? `reel_${afterReelId}_${afterLikes.likesText || 'unknown'}` : 'unknown';
    
    if (afterId !== beforeId && afterReelId !== beforeReelId) {
      await saveLogToDB(accountId, 'info', `[SCROLL] ✅ SUCCESS: Scrolled to new reel (verified by likes: ${beforeLikes.likesText} -> ${afterLikes.likesText})`);
      return true;
    }
  }
  
  // Try one more scroll attempt
  await saveLogToDB(accountId, 'warn', `[SCROLL] Scroll may have failed, retrying...`);
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(1500);
  
  const finalUrl = page.url();
  const finalReelId = finalUrl.match(/\/reels?\/([^\/?#]+)/)?.[1];
  
  if (finalReelId && finalReelId !== beforeReelId) {
    await saveLogToDB(accountId, 'info', `[SCROLL] ✅ SUCCESS after retry: Scrolled to new reel (reelId: ${beforeReelId} -> ${finalReelId})`);
    return true;
  } else {
    const finalAfterReelId = finalReelId || afterReelId || 'unknown';
    await saveLogToDB(accountId, 'warn', `[SCROLL] ❌ FAILED: Still on same reel. beforeReelId=${beforeReelId}, afterReelId=${finalAfterReelId}`);
    return false;
  }
}

async function ensureOnReelsPage(page, accountId, skipIfOnReels = false) {
  try {
    const cur = page.url();
    
    // Must be on the general reels feed, not a specific reel URL
    // General feed: https://www.instagram.com/reels/ or https://www.instagram.com/reels
    // Specific reel: https://www.instagram.com/reels/DP7gKniiLWS/
    const isGeneralFeed = cur.endsWith('/reels/') || cur.endsWith('/reels') || 
                          (cur.includes('/reels/') && cur.split('/reels/')[1].trim().length === 0);
    
    // If we're already on reels (even a specific reel URL), and skipIfOnReels is true, don't navigate
    // This prevents resetting scroll position when we're already viewing reels
    if (skipIfOnReels && (cur.includes('/reels') || cur.includes('/reel')) && !cur.includes('/accounts/login')) {
      try {
        await page.waitForSelector('video', { timeout: 2000, state: 'visible' });
        await saveLogToDB(accountId, 'info', 'Already on reels page, skipping navigation to preserve scroll position');
        return; // Already on reels page with content
      } catch (e) {
        // Content not loaded, need to navigate
        await saveLogToDB(accountId, 'info', 'On reels page but content not loaded, refreshing');
      }
    }
    
    // If we're on a specific reel URL (not general feed), and skipIfOnReels is true, use browser back button
    // This preserves scroll position better than navigating to /reels/
    if (skipIfOnReels && !isGeneralFeed && cur.includes('/reels/') && !cur.includes('/accounts/login')) {
      try {
        await saveLogToDB(accountId, 'info', 'On specific reel URL, using browser back to preserve scroll position');
        await page.goBack({ waitUntil: 'load', timeout: 30000 });
        await page.waitForTimeout(1000);
        // Verify we're back on reels
        const newUrl = page.url();
        if (newUrl.includes('/reels') && !newUrl.includes('/accounts/login')) {
          await page.waitForSelector('video', { timeout: 5000, state: 'visible' });
          await saveLogToDB(accountId, 'info', 'Successfully returned to reels page via back button');
          return;
        }
      } catch (e) {
        await saveLogToDB(accountId, 'warn', `Browser back failed: ${e.message}, falling back to navigation`);
      }
    }
    
    if (isGeneralFeed && !cur.includes('/accounts/login')) {
      // Verify reels content is actually loaded
      try {
        await page.waitForSelector('video', { timeout: 2000, state: 'visible' });
        return; // Already on general reels feed with content
      } catch (e) {
        // Content not loaded, need to navigate
        await saveLogToDB(accountId, 'info', 'On reels page but content not loaded, refreshing');
      }
    }
    
    // Navigate to general reels feed (not a specific reel)
    // This will reset scroll position, but it's necessary if we're coming from a profile page
    await saveLogToDB(accountId, 'info', 'Navigating to reels page');
    
    // Use 'load' instead of 'networkidle' - Instagram's reels page never truly idles
    await page.goto('https://www.instagram.com/reels/', { 
      waitUntil: 'load', 
      timeout: 30000 
    });
    
    // Wait for page to settle
    await page.waitForTimeout(1000);
    
    // Check if we got redirected to login
    const finalUrl = page.url();
    if (finalUrl.includes('/accounts/login')) {
      await saveLogToDB(accountId, 'error', 'Redirected to login page - session may have expired');
      throw new Error('Session expired - redirected to login');
    }
    
    // Wait for reels content to actually appear (videos)
    try {
      await page.waitForSelector('video', { timeout: 10000, state: 'visible' });
      await saveLogToDB(accountId, 'info', 'Reels page loaded with video content');
    } catch (e) {
      await saveLogToDB(accountId, 'warn', 'Reels page loaded but no video found - waiting longer');
      await page.waitForTimeout(2000);
      // Final check
      const hasVideo = await page.evaluate(() => document.querySelector('video') !== null);
      if (!hasVideo) {
        await saveLogToDB(accountId, 'error', 'No video content found on reels page after waiting');
        throw new Error('No video content on reels page');
      }
    }
    
  } catch (e) {
    await saveLogToDB(accountId, 'error', `ensureOnReelsPage failed: ${e.message}`);
    throw e;
  }
}

async function processReelOutreach(page, account, reelUrl, username) {
  // Store the current reel URL before navigating to profile
  const currentReelUrl = page.url();
  
  // Navigate directly to user profile to avoid navigation issues
  try {
    await saveLogToDB(account.id, 'info', `Outreach start for ${username}`);

    // Navigate directly to profile URL - this avoids clicking links that might cause navigation issues
    const profileUrl = `https://www.instagram.com/${username}/`;
    await saveLogToDB(account.id, 'info', `Navigating to profile: ${profileUrl}`);
    await page.goto(profileUrl, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(1000); // Wait for page to settle

    // Try to click Message (many variants)
    let messageClicked = false;
    for (const s of INSTAGRAM_REEL_SELECTORS.MESSAGE_BUTTON) {
      try {
        await page.click(s, { timeout: 3000 });
        messageClicked = true;
        break;
      } catch (e) {}
    }
    if (!messageClicked) {
      // try text button
      try { await page.click('text=Message', { timeout: 3000 }); messageClicked = true; } catch (e) {}
    }
    if (!messageClicked) throw new Error('Message button not found');

    // Wait for message input to appear and focus it
    await page.waitForTimeout(1000);
    const inputSelector = '[contenteditable="true"], textarea';
    await page.waitForSelector(inputSelector, { timeout: 5000 }).catch(() => {
      throw new Error('Message input not found');
    });
    
    // Focus the input first
    await page.click(inputSelector, { timeout: 3000 });
    await page.waitForTimeout(300);

    // Input and send
    const msg = (account.outreachMessage || '').trim();
    if (!msg) throw new Error('Outreach message empty');

    await saveLogToDB(account.id, 'info', `Typing message (length: ${msg.length})`);

    // Try to set text using multiple methods for reliability
    const textSet = await page.evaluate((m) => {
      // Method 1: Try contenteditable div (Instagram's preferred method)
      const contentEditable = document.querySelector('[contenteditable="true"]');
      if (contentEditable) {
        // Focus it first
        contentEditable.focus();
        
        // Clear existing content first - select all and delete
        const range = document.createRange();
        range.selectNodeContents(contentEditable);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        
        // Clear the content
        contentEditable.textContent = '';
        contentEditable.innerHTML = '';
        
        // Set the text using textContent (preserves special characters correctly)
        // textContent is better than innerText for special characters like em dashes
        contentEditable.textContent = m;
        
        // Also set innerText as fallback (some Instagram versions might use this)
        if (contentEditable.textContent !== m) {
          contentEditable.innerText = m;
        }
        
        // Trigger all necessary events to ensure Instagram recognizes the input
        contentEditable.dispatchEvent(new Event('input', { bubbles: true }));
        contentEditable.dispatchEvent(new Event('change', { bubbles: true }));
        contentEditable.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'a' }));
        contentEditable.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'a' }));
        
        // Verify text was set
        const setText = contentEditable.textContent || contentEditable.innerText || '';
        return setText.length > 0 && setText.length >= m.length * 0.9; // Allow 10% tolerance for formatting
      }
      
      // Method 2: Try textarea
      const textarea = document.querySelector('textarea');
      if (textarea) {
        textarea.focus();
        textarea.value = '';
        textarea.value = m;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
        return textarea.value.length > 0 && textarea.value.length >= m.length * 0.9;
      }
      
      return false;
    }, msg);

    // If setting text via evaluate failed, use keyboard typing as fallback
    if (!textSet) {
      await saveLogToDB(account.id, 'info', 'Text setting via evaluate failed, using keyboard typing');
      
      // Clear the input first
      await page.click('[contenteditable="true"], textarea', { timeout: 3000 });
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Delete');
      await page.waitForTimeout(200);
      
      // Type the message character by character
      await page.keyboard.type(msg, { delay: 10 });
    }

    // Wait for text to be fully entered and verify
    await page.waitForTimeout(500);
    
    // Verify the message was set correctly
    const verifyText = await page.evaluate(() => {
      const contentEditable = document.querySelector('[contenteditable="true"]');
      if (contentEditable) {
        return (contentEditable.textContent || contentEditable.innerText || '').trim();
      }
      const textarea = document.querySelector('textarea');
      if (textarea) {
        return textarea.value.trim();
      }
      return '';
    });

    if (verifyText.length < msg.length * 0.8) {
      await saveLogToDB(account.id, 'warn', `Message verification failed: expected ${msg.length} chars, got ${verifyText.length}`);
      // Try one more time with keyboard typing
      await page.click('[contenteditable="true"], textarea', { timeout: 3000 });
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Delete');
      await page.waitForTimeout(200);
      await page.keyboard.type(msg, { delay: 15 });
      await page.waitForTimeout(500);
    } else {
      await saveLogToDB(account.id, 'info', `Message verified: ${verifyText.length} characters set`);
    }

    // click send
    let sent = false;
    for (const s of INSTAGRAM_REEL_SELECTORS.SEND_BUTTON) {
      try { await page.click(s, { timeout: 3000 }); sent = true; break; } catch (e) {}
    }
    if (!sent) {
      try { await page.keyboard.press('Enter'); sent = true; } catch (e) { }
    }

    await page.waitForTimeout(1000);
    
    // Close message modal if it's still open
    try {
      const closeButtons = [
        'svg[aria-label="Close"]',
        'div[role="button"]:has(svg[aria-label="Close"])',
        'button[aria-label="Close"]'
      ];
      for (const selector of closeButtons) {
        try {
          await page.click(selector, { timeout: 2000 });
          await saveLogToDB(account.id, 'info', 'Closed message modal');
          await page.waitForTimeout(500);
          break;
        } catch (e) {}
      }
    } catch (e) {}
    
    // Use browser back button to return to reels (preserves scroll position better)
    // This works because we navigated: reels -> profile, so back goes: profile -> reels
    try {
      await saveLogToDB(account.id, 'info', 'Using browser back to return to reels page');
      await page.goBack({ waitUntil: 'load', timeout: 30000 });
      await page.waitForTimeout(1000);
      
      const finalUrl = page.url();
      if (finalUrl.includes('/reels') && !finalUrl.includes('/accounts/login')) {
        await page.waitForSelector('video', { timeout: 5000, state: 'visible' });
        await saveLogToDB(account.id, 'info', 'Successfully returned to reels page via back button');
        return { success: true, sent };
      }
    } catch (e) {
      await saveLogToDB(account.id, 'warn', `Browser back failed: ${e.message}, falling back to navigation`);
    }
    
    // Fallback: navigate to general reels feed (will reset scroll, but better than being stuck)
    await ensureOnReelsPage(page, account.id, false);

    // record outreach
    const reel = await prisma.reel.findFirst({ where: { accountId: account.id, reelUrl } });
    if (reel) {
      await prisma.outreach.create({ data: { reelId: reel.id, targetUser: username, message: msg, sent: sent, sentAt: sent ? new Date() : null } });
    }

    return { success: true, sent };
  } catch (error) {
    await saveLogToDB(account.id, 'error', `Outreach failed: ${error.message}`);
    try { await ensureOnReelsPage(page, account.id, true); } catch (e) {}
    return { success: false, error: error.message };
  }
}

async function collectReels(page, account) {
  await saveLogToDB(account.id, 'info', 'Starting collectReels');
  
  // STEP 1: Go to general reels feed (NOT a specific user's reels)
  await saveLogToDB(account.id, 'info', 'Navigating to general reels feed');
  await page.goto('https://www.instagram.com/reels/', { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(2000);
  
  // Wait for first video to load
  try {
    await page.waitForSelector('video', { timeout: 10000, state: 'visible' });
    await saveLogToDB(account.id, 'info', 'Reels page loaded with video content');
  } catch (e) {
    await saveLogToDB(account.id, 'error', 'No video found on reels page');
    throw new Error('No video content on reels page');
  }
  

  const reels = [];
  const seen = new Set();
  let reelCount = 0;
  const maxReels = 50;
  let consecutiveFailures = 0;

  while (reelCount < maxReels) {
    // Check account status
    const currentAccount = await prisma.account.findUnique({ where: { id: account.id } });
    if (currentAccount?.status !== ACCOUNT_STATUS.RUNNING) break;
    if (consecutiveFailures >= 3) { 
      await saveLogToDB(account.id, 'warn', 'Too many consecutive failures'); 
      break; 
    }

    // STEP 2: Extract like count first (fast check before extracting username)
    await saveLogToDB(account.id, 'info', `[LOOP] Waiting 1000ms before extraction...`);
    await page.waitForTimeout(1000);
    
    const likesOnly = await extractLikesOnly(page, account.id);
    const likes = parseLikesCount(likesOnly.likesText);
    
    // STEP 3: Check like threshold - if below, skip (don't extract username, don't save)
    if (!likesOnly.likesText || likes < REEL_FILTERS.MIN_LIKES) {
      await saveLogToDB(account.id, 'info', `Reel below threshold: ${likes} likes < ${REEL_FILTERS.MIN_LIKES}, skipping`);
      const ok = await attemptScrollToNextReel(page, account.id);
      if (!ok) { consecutiveFailures++; } else { consecutiveFailures = 0; reelCount++; }
      continue;
    }
    
    // STEP 4: Likes >= threshold - now extract full info (username, reelId, etc.)
    await saveLogToDB(account.id, 'info', `Reel qualifies: ${likes} likes >= ${REEL_FILTERS.MIN_LIKES}, extracting full info...`);
    
    const currentUrl = page.url();
    await saveLogToDB(account.id, 'info', `[LOOP] Current URL before extraction: ${currentUrl}`);
    
    const info = await extractCurrentReelInfo(page, account.id);
    await saveLogToDB(account.id, 'info', `[LOOP] Extracted: user=${info.username} likes=${info.likesText} url=${info.url} uniqueId=${info.uniqueId}`);
    
    // Verify the extracted URL matches current URL (or is close)
    if (info.url && currentUrl.includes('/reels/')) {
      const extractedReelId = info.url.match(/\/reels?\/([^\/?#]+)/)?.[1];
      const currentReelId = currentUrl.match(/\/reels?\/([^\/?#]+)/)?.[1];
      await saveLogToDB(account.id, 'info', `[LOOP] URL verification: currentReelId=${currentReelId || 'null'}, extractedReelId=${extractedReelId || 'null'}`);
      
      if (extractedReelId && currentReelId && extractedReelId !== currentReelId) {
        await saveLogToDB(account.id, 'warn', `[LOOP] ⚠️ URL MISMATCH! Current: ${currentReelId}, Extracted: ${extractedReelId} - re-extracting`);
        await page.waitForTimeout(1000);
        const info2 = await extractCurrentReelInfo(page, account.id);
        if (info2.url) {
          const extractedReelId2 = info2.url.match(/\/reels?\/([^\/?#]+)/)?.[1];
          await saveLogToDB(account.id, 'info', `[LOOP] Re-extraction: extractedReelId2=${extractedReelId2 || 'null'}, currentReelId=${currentReelId || 'null'}`);
          if (extractedReelId2 === currentReelId) {
            await saveLogToDB(account.id, 'info', '[LOOP] ✅ Re-extraction successful, using corrected data');
            Object.assign(info, info2);
          } else {
            await saveLogToDB(account.id, 'warn', `[LOOP] ❌ Re-extraction still mismatched: ${extractedReelId2} !== ${currentReelId}`);
          }
        }
      } else {
        await saveLogToDB(account.id, 'info', `[LOOP] ✅ URL matches (or one is null)`);
      }
    }

    // Skip if extraction failed (missing username or other critical data)
    if (!info.uniqueId || !info.username || !info.likesText) {
      await saveLogToDB(account.id, 'warn', 'Invalid extraction (missing username or other data), scrolling to next');
      const ok = await attemptScrollToNextReel(page, account.id);
      if (!ok) { consecutiveFailures++; } else { consecutiveFailures = 0; reelCount++; }
      continue;
    }

    // Skip if already seen
    if (seen.has(info.uniqueId)) {
      await saveLogToDB(account.id, 'info', `Already seen ${info.uniqueId}, scrolling to next`);
      const ok = await attemptScrollToNextReel(page, account.id);
      if (!ok) { consecutiveFailures++; } else { consecutiveFailures = 0; reelCount++; }
      continue;
    }

    seen.add(info.uniqueId);
    consecutiveFailures = 0;

    // Save to DB (only reels that meet threshold)
    let reel = await prisma.reel.findFirst({ where: { accountId: account.id, reelUrl: info.url } });
    const parsedLikes = parseLikesCount(info.likesText);
    if (!reel) {
      reel = await prisma.reel.create({ 
        data: { 
          accountId: account.id, 
          reelUrl: info.url, 
          views: parsedLikes, 
          isAd: false, 
          isLive: false 
        } 
      });
      reels.push(reel);
    }

    // STEP 5: Do outreach (we already know likes >= threshold)
    await saveLogToDB(account.id, 'info', `Processing outreach for @${info.username} (${parsedLikes} likes)`);
    
    const already = await prisma.outreach.findFirst({ 
      where: { reelId: reel.id, targetUser: info.username } 
    });
    
    if (!already) {
      const res = await processReelOutreach(page, account, info.url, info.username);
      if (res.success && res.sent) {
        await saveLogToDB(account.id, 'info', `Successfully sent outreach to @${info.username}`);
      }
      // processReelOutreach already calls ensureOnReelsPage, so we don't need to navigate again
      await page.waitForTimeout(1000);
    } else {
      await saveLogToDB(account.id, 'info', `Already sent outreach to @${info.username}, skipping`);
    }

    // STEP 6: Scroll ONCE to next video
    await saveLogToDB(account.id, 'info', 'Scrolling to next reel...');
    const scrolled = await attemptScrollToNextReel(page, account.id);
    if (!scrolled) {
      consecutiveFailures++;
      await saveLogToDB(account.id, 'warn', `Failed to scroll to next reel (failures: ${consecutiveFailures}/3)`);
    } else {
      consecutiveFailures = 0;
      reelCount++;
    }
  }

  await saveLogToDB(account.id, 'info', `collectReels finished: collected=${reels.length}`);
  return { reels, outreachCount: 0 };
}

export async function runPlaywrightBot(account) {
  let browser, context, page;
  try {
    await saveLogToDB(account.id, 'info', 'Bot started');

    const { display, vncPort } = await initializeDisplayForAccount(account.id);
    const displayEnv = `:${display}`;
    
    // Log VNC connection info for viewing the browser
    await saveLogToDB(account.id, 'info', `Using display :${display}, VNC port ${vncPort}`);
    logger.info(`Account ${account.username} using display :${display}, VNC port ${vncPort}`);

    // For VNC to work, browser must run in non-headless mode
    // This allows the browser to render to the X display that VNC is streaming
    const launchOptions = {
      headless: false, // Must be false for VNC viewing
      channel: 'chrome',
      env: { DISPLAY: displayEnv },
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu', // GPU not needed in virtual display
        '--disable-software-rasterizer'
      ]
    };

    const proxy = account.proxy || getProxyForAccount(account.id);
    if (proxy) launchOptions.proxy = { server: proxy };

    browser = await chromium.launch(launchOptions);
    context = await browser.newContext({ viewport: { width: 1280, height: 720 } });

    // load cookies
    if (sessionExists(account.id)) {
      const sd = loadSession(account.id);
      if (sd && sd.cookies) await context.addCookies(sd.cookies);
    }

    page = await context.newPage();
    await setupStealthMode(page);

    if (!sessionExists(account.id)) {
      await saveLogToDB(account.id, 'info', 'No saved session found, logging in...');
      await loginToInstagram(page, account);
      await saveLogToDB(account.id, 'info', 'Logged in and saving session');
      const cookies = await context.cookies();
      saveSession(account.id, { cookies });
    } else {
      await saveLogToDB(account.id, 'info', 'Saved session found, verifying...');
      await page.goto('https://www.instagram.com/', { waitUntil: 'load', timeout: 30000 });
      await page.waitForTimeout(2000);
      
      // Check if we're logged in
      const isLoggedIn = await page.evaluate(() => {
        // Check if login form is present
        const hasLoginForm = !!document.querySelector('input[name="username"]');
        // Check if we're on a logged-in page (has navigation, profile link, etc.)
        const hasNav = !!document.querySelector('nav') || !!document.querySelector('a[href*="/direct/"]');
        return !hasLoginForm && hasNav;
      });
      
      if (!isLoggedIn) {
        await saveLogToDB(account.id, 'info', 'Session expired, re-logging in...');
        // Delete old session before re-logging
        const { deleteSession } = await import('../utils/sessionManager.js');
        deleteSession(account.id);
        await loginToInstagram(page, account);
        const cookies = await context.cookies();
        saveSession(account.id, { cookies });
      } else {
        await saveLogToDB(account.id, 'info', 'Session is valid, using saved session');
      }
    }

    const result = await collectReels(page, account);

    // save final session
    const cookies = await context.cookies();
    saveSession(account.id, { cookies });

    await saveLogToDB(account.id, 'info', `Bot finished: reels=${result.reels.length}`);
    return { success: true, reelsCollected: result.reels.length };
  } catch (error) {
    logger.error('Bot error', error);
    await saveLogToDB(account.id, 'error', `Bot error: ${error.message}`);
    throw error;
  } finally {
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}
