import { chromium } from 'playwright';

async function openInstagramLogin() {
  console.log('Launching browser...');
  
  // Launch actual Google Chrome (not Chromium) with automation detection disabled
  const browser = await chromium.launch({
    headless: false, // Show browser window
    channel: 'chrome', // Use actual Chrome browser installed on system
    args: [
      '--disable-blink-features=AutomationControlled', // Remove automation flag
      '--disable-dev-shm-usage',
      '--no-sandbox'
    ]
  });

  // Create a new context that looks like a normal browser
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });

  const page = await context.newPage();

  // Remove automation indicators to make it look like a normal browser
  await page.addInitScript(() => {
    // Remove webdriver property
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined
    });

    // Override the plugins property to use a custom getter
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5]
    });

    // Override the languages property to use a custom getter
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en']
    });

    // Override permissions
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters) => (
      parameters.name === 'notifications' ?
        Promise.resolve({ state: Notification.permission }) :
        originalQuery(parameters)
    );
  });

  console.log('Navigating to Instagram login page...');
  
  // Navigate to Instagram login page
  await page.goto('https://www.instagram.com/accounts/login/', {
    waitUntil: 'networkidle'
  });

  console.log('Waiting for login form...');
  
  // Try to find username field with fallback options
  let usernameSelector = null;
  const usernameSelectors = [
    'input[name="username"]',
    'input[name="email"]',
    'input[aria-label="Phone number, username, or email"]'
  ];
  
  for (const selector of usernameSelectors) {
    try {
      await page.waitForSelector(selector, { timeout: 5000 });
      usernameSelector = selector;
      console.log(`Found username field using: ${selector}`);
      break;
    } catch (e) {
      // Try next selector
    }
  }
  
  if (!usernameSelector) {
    throw new Error('Could not find username/email input field');
  }
  
  console.log('Filling in username...');
  // Fill in username
  await page.fill(usernameSelector, 'Larraclips');
  
  // Try to find password field with fallback options
  let passwordSelector = null;
  const passwordSelectors = [
    'input[name="password"]',
    'input[name="pass"]',
    'input[aria-label="Password"]'
  ];
  
  for (const selector of passwordSelectors) {
    try {
      await page.waitForSelector(selector, { timeout: 5000 });
      passwordSelector = selector;
      console.log(`Found password field using: ${selector}`);
      break;
    } catch (e) {
      // Try next selector
    }
  }
  
  if (!passwordSelector) {
    throw new Error('Could not find password input field');
  }
  
  console.log('Filling in password...');
  // Fill in password
  await page.fill(passwordSelector, '9KH_PF>vUu%N-Yw');
  
  console.log('Clicking login button...');
  // Try multiple ways to find and click the login button
  const loginButtonSelectors = [
    'button[type="submit"]:not([disabled])',
    'button:has-text("Log in"):not([disabled])',
    'div[role="none"]:has-text("Log in")',
    'span:has-text("Log in")'
  ];
  
  let loginClicked = false;
  for (const selector of loginButtonSelectors) {
    try {
      await page.waitForSelector(selector, { timeout: 3000 });
      await page.click(selector);
      loginClicked = true;
      console.log(`Clicked login button using: ${selector}`);
      break;
    } catch (e) {
      // Try next selector
    }
  }
  
  // If none of the selectors worked, try clicking by text content
  if (!loginClicked) {
    try {
      await page.click('text=Log in', { timeout: 3000 });
      loginClicked = true;
      console.log('Clicked login button using text selector');
    } catch (e) {
      // Last resort: try to find any button and click it
      const buttons = await page.$$('button');
      for (const button of buttons) {
        const text = await button.textContent();
        if (text && text.trim().toLowerCase().includes('log in')) {
          await button.click();
          loginClicked = true;
          console.log('Clicked login button by searching all buttons');
          break;
        }
      }
    }
  }
  
  if (!loginClicked) {
    throw new Error('Could not find or click login button');
  }
  
  console.log('Waiting for login to complete...');
  
  // Wait for navigation away from login page (login successful)
  await page.waitForURL((url) => !url.href.includes('/accounts/login/'), { timeout: 30000 });
  
  console.log('✅ Login successful! Browser will stay open.');
  console.log('Press Ctrl+C to exit.');

  // Keep the browser open indefinitely
  // Handle process termination gracefully
  process.on('SIGINT', async () => {
    console.log('\n👋 Closing browser...');
    await browser.close();
    process.exit(0);
  });

  // Keep the process alive - wait indefinitely
  await new Promise(() => {});
}

// Run the automation
openInstagramLogin().catch(console.error);

