# Instagram Automation System

A production-ready, scalable multi-account Instagram automation system built with Node.js, React, PostgreSQL, Redis, and Playwright.

## 🏗️ Architecture

- **Backend**: Express.js API with Prisma ORM, BullMQ job queue, and Playwright automation
- **Frontend**: React dashboard with Tailwind CSS
- **Database**: PostgreSQL for persistent storage
- **Queue**: Redis + BullMQ for job management
- **Automation**: Playwright for browser automation

## 🚀 Quick Start

### Prerequisites

- Docker and Docker Compose
- Node.js 20+ (for local development)
- PostgreSQL 16+ (if running locally)
- Redis 7+ (if running locally)

### Setup

1. **Clone and navigate to the project:**
   ```bash
   cd instagram-automation
   ```

2. **Copy environment file:**
   ```bash
   cp shared/.env.example shared/.env
   ```

3. **Edit `.env` file with your configuration:**
   ```env
   DATABASE_URL=postgresql://user:password@db:5432/instagram_automation
   REDIS_URL=redis://redis:6379
   PORT=4000
   ```

4. **Start all services with Docker Compose:**
   ```bash
   docker-compose up -d
   ```

5. **Run database migrations:**
   ```bash
   docker exec -it instagram-backend npx prisma migrate dev
   ```

6. **Access the application:**
   - Frontend: http://localhost:3000
   - Backend API: http://localhost:4000
   - API Health: http://localhost:4000/health

## 📁 Project Structure

```
instagram-automation/
├── backend/          # Express API server
│   ├── src/
│   │   ├── routes/   # API routes
│   │   ├── controllers/  # Request handlers
│   │   ├── workers/  # Bot workers
│   │   ├── queues/   # Job queue setup
│   │   ├── db/       # Prisma schema
│   │   └── utils/    # Utilities
│   └── Dockerfile
├── frontend/         # React dashboard
│   ├── src/
│   │   ├── pages/    # Page components
│   │   ├── components/  # Reusable components
│   │   └── api/      # API client
│   └── Dockerfile
├── shared/           # Shared configs
│   ├── .env.example
│   ├── docker-compose.yml
│   └── README.md
└── sessions/         # Stored browser sessions
    └── {account_id}/
        └── auth.json
```

## 🔧 Development

### Backend Development

```bash
cd backend
npm install
npm run dev
```

### Frontend Development

```bash
cd frontend
npm install
npm run dev
```

### Database Migrations

```bash
cd backend
npx prisma migrate dev
npx prisma studio  # Open Prisma Studio
```

## 📊 Features

### Account Management
- Add/remove Instagram accounts
- Start/stop bots per account
- View account status and logs
- Session management

### Reel Collection
- Automatically scroll and collect reels
- Filter by views (default: >100k)
- Exclude ads and live videos
- Store reel data in database

### Outreach Automation
- Extract users from high-performing reels
- Send automated DMs
- Track outreach status
- Rate limiting

### Dashboard
- Real-time account status
- Analytics and statistics
- Logs viewer
- Reel and outreach management

## 🔐 Security Notes

- Store passwords securely (use environment variables or secret management)
- Use proxies for account isolation
- Implement rate limiting
- Monitor for Instagram detection
- Rotate sessions regularly

## 📈 Scaling

The system is designed to scale:

- **Horizontal Scaling**: Run multiple backend instances
- **Worker Scaling**: Adjust `MAX_CONCURRENT_BOTS` in `.env`
- **Database**: Use connection pooling (Prisma handles this)
- **Redis**: Cluster mode for high availability
- **Kubernetes**: Ready for K8s deployment

## 🐛 Troubleshooting

### Database Connection Issues
- Check `DATABASE_URL` in `.env`
- Ensure PostgreSQL container is running
- Verify network connectivity

### Redis Connection Issues
- Check `REDIS_URL` in `.env`
- Ensure Redis container is running

### Playwright Issues
- Ensure browsers are installed: `npx playwright install`
- Check headless mode settings
- Verify Chrome/Chromium installation

## 📝 API Endpoints

### Accounts
- `GET /api/accounts` - List all accounts
- `GET /api/accounts/:id` - Get account details
- `POST /api/accounts` - Create account
- `PUT /api/accounts/:id` - Update account
- `DELETE /api/accounts/:id` - Delete account
- `POST /api/accounts/:id/start` - Start bot
- `POST /api/accounts/:id/stop` - Stop bot

### Reels
- `GET /api/reels` - List reels
- `GET /api/reels/:id` - Get reel details
- `GET /api/reels/account/:accountId` - Get reels by account
- `POST /api/reels` - Create reel

### Outreach
- `GET /api/outreach` - List outreach
- `GET /api/outreach/reel/:reelId` - Get outreach by reel
- `POST /api/outreach` - Create outreach
- `PUT /api/outreach/:id` - Update outreach

## 📄 License

MIT

## ⚠️ Disclaimer

This tool is for educational purposes. Use responsibly and in accordance with Instagram's Terms of Service.

