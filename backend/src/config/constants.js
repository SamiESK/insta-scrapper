export const ACCOUNT_STATUS = {
  IDLE: 'idle',
  RUNNING: 'running',
  PAUSED: 'paused',
  ERROR: 'error',
  STOPPED: 'stopped'
};

export const QUEUE_NAMES = {
  BOT_WORKER: 'bot-worker'
};

export const INSTAGRAM_SELECTORS = {
  USERNAME: [
    'input[name="username"]',
    'input[name="email"]',
    'input[aria-label="Phone number, username, or email"]'
  ],
  PASSWORD: [
    'input[name="password"]',
    'input[name="pass"]',
    'input[aria-label="Password"]'
  ],
  LOGIN_BUTTON: [
    'button[type="submit"]:not([disabled])',
    'button:has-text("Log in"):not([disabled])',
    'div[role="none"]:has-text("Log in")',
    'span:has-text("Log in")'
  ]
};

export const REEL_FILTERS = {
  MIN_LIKES: 100000, // Changed from MIN_VIEWS to MIN_LIKES
  EXCLUDE_ADS: true,
  EXCLUDE_LIVE: true
};

export const INSTAGRAM_REEL_SELECTORS = {
  // Like count - looks for span with number like "8M", "100K", etc.
  // Based on HTML: <span class="...">8M</span> in like button area
  LIKE_COUNT: [
    'span[dir="auto"]:has-text("M")',
    'span[dir="auto"]:has-text("K")',
    'div[role="button"] span:has-text("M")',
    'div[role="button"] span:has-text("K")'
  ],
  // Username link - clickable username in reel
  // Based on HTML: <span class="...">clarazrd</span> in a link
  USERNAME: [
    'a[href^="/"] span[dir="auto"]', // Username span in link
    'a[href^="/"]' // The link itself
  ],
  // Message button on profile
  // Based on HTML: <div role="button" ...>Message</div>
  MESSAGE_BUTTON: [
    'div[role="button"]:has-text("Message")',
    'button:has-text("Message")',
    'a:has-text("Message")',
    'div:has-text("Message")[role="button"]'
  ],
  // Message input (contenteditable div)
  // Based on HTML: <div contenteditable="true" role="textbox" aria-placeholder="Message...">
  MESSAGE_INPUT: [
    'div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"][aria-label*="Message"]',
    'div[contenteditable="true"][aria-placeholder*="Message"]',
    'div[contenteditable="true"].notranslate'
  ],
  // Close button in message modal
  // Based on HTML: <div role="button" ...><svg aria-label="Close">...</svg></div>
  CLOSE_BUTTON: [
    'div[role="button"]:has(svg[aria-label="Close"])',
    'button[aria-label="Close"]',
    'div[role="button"] svg[aria-label="Close"]',
    'svg[aria-label="Close"]'
  ],
  // Send button (if needed)
  SEND_BUTTON: [
    'button:has-text("Send")',
    'div[role="button"]:has-text("Send")'
  ]
};

