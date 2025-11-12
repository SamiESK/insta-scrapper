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
  MIN_VIEWS: 100000,
  EXCLUDE_ADS: true,
  EXCLUDE_LIVE: true
};

