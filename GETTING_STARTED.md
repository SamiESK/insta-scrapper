# Getting Started Guide

## Step-by-Step Setup

### Prerequisites
- Docker Desktop installed and running
- Git (optional)

### Step 1: Create Environment File

Create `shared/.env` file:

```powershell
# Copy the template
Copy-Item shared\ENV_TEMPLATE.txt shared\.env
```

Then edit `shared/.env` and set these values:

```env
# Database (matches docker-compose.yml)
DATABASE_URL=postgresql://user:password@db:5432/instagram_automation

# Redis
REDIS_URL=redis://redis:6379

# Server
PORT=4000
NODE_ENV=development

# Playwright (set to false to see browser)
PLAYWRIGHT_HEADLESS=false

# Bot settings
MAX_CONCURRENT_BOTS=10
LOG_LEVEL=info

# Encryption key (generate one: openssl rand -hex 32)
ENCRYPTION_KEY=your-key-here
```

### Step 2: Generate Encryption Key (Optional but Recommended)

```powershell
# If you have OpenSSL installed:
openssl rand -hex 32

# Or use PowerShell:
-join ((48..57) + (97..102) | Get-Random -Count 64 | ForEach-Object {[char]$_})
```

Copy the generated key and paste it as `ENCRYPTION_KEY` in your `.env` file.

### Step 3: Start Docker Services

```powershell
# Navigate to project root
cd C:\Users\SHOMEE\Desktop\insta-scrapper

# Start all services
docker-compose -f shared\docker-compose.yml up -d
```

This will start:
- PostgreSQL database
- Redis
- Backend API
- Frontend dashboard

### Step 4: Run Database Migrations

```powershell
# Wait a few seconds for containers to start, then:
docker exec -it instagram-backend npx prisma migrate dev --name init
```

### Step 5: Access the Application

- **Frontend Dashboard**: http://localhost:3000
- **Backend API**: http://localhost:4000
- **API Health Check**: http://localhost:4000/health

### Step 6: Add Your First Account

**Option A: Via Frontend (Easiest)**
1. Open http://localhost:3000
2. Go to "Accounts" page
3. Click "Add Account"
4. Enter:
   - Username: your_instagram_username
   - Password: (optional - leave empty for manual login)
   - Proxy: (optional)
5. Click "Create Account"

**Option B: Via API**
```powershell
Invoke-RestMethod -Uri "http://localhost:4000/api/accounts" `
  -Method POST `
  -ContentType "application/json" `
  -Body '{"username":"your_username","password":"your_password"}'
```

### Step 7: Start the Bot

**Via Frontend:**
1. Go to Accounts page
2. Find your account
3. Click "Start" button

**Via API:**
```powershell
Invoke-RestMethod -Uri "http://localhost:4000/api/accounts/1/start" -Method POST
```

## Troubleshooting

### Check if services are running:
```powershell
docker ps
```

### View backend logs:
```powershell
docker logs instagram-backend
```

### View frontend logs:
```powershell
docker logs instagram-frontend
```

### Restart a service:
```powershell
docker restart instagram-backend
```

### Stop all services:
```powershell
docker-compose -f shared\docker-compose.yml down
```

### View database:
```powershell
docker exec -it instagram-backend npx prisma studio
```
Then open http://localhost:5555

## Development Mode (Without Docker)

If you prefer to run locally without Docker:

### Backend:
```powershell
cd backend
npm install
npm run dev
```

### Frontend:
```powershell
cd frontend
npm install
npm run dev
```

### Database & Redis:
You'll need to install PostgreSQL and Redis locally, or use Docker just for those:
```powershell
docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=password postgres:16
docker run -d -p 6379:6379 redis:7-alpine
```

## Next Steps

1. Add multiple accounts
2. Configure proxies (optional)
3. Start bots for accounts
4. Monitor in dashboard
5. Check analytics page for results

