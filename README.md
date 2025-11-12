# Instagram Automation Tool

An Instagram automation tool built with Playwright that supports multiple accounts and session management.

## Features

- 🎭 Playwright-based automation
- 💾 Browser session saving
- 👥 Multi-account support (30+ accounts)
- 🗄️ Database integration (coming soon)
- 🖥️ GUI interface (coming soon)

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Install Playwright browsers:**
   ```bash
   npm run install-browsers
   ```

3. **Run the automation:**
   ```bash
   npm start
   ```

## Current Functionality

- Opens Instagram login page in a browser window
- Allows manual login
- Session storage structure ready for future implementation

## Project Structure

```
insta-scrapper/
├── src/
│   └── index.js          # Main automation script
├── sessions/             # Browser sessions storage (created automatically)
├── package.json
└── README.md
```

## Next Steps

- [ ] Implement session saving/loading
- [ ] Add database integration
- [ ] Create GUI for account management
- [ ] Add automation features

