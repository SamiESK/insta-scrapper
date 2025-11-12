# Account Setup Guide

## How to Add Instagram Accounts

There are two ways to authenticate accounts:

### Method 1: With Password (Recommended for Automation)

Store the username and password in the database. The password will be encrypted.

**Via API:**
```bash
POST http://localhost:4000/api/accounts
Content-Type: application/json

{
  "username": "your_instagram_username",
  "password": "your_password",
  "proxy": "http://proxy.com:8080"  // Optional
}
```

**Via Frontend:**
1. Go to Accounts page
2. Click "Add Account"
3. Enter username and password
4. Optionally add proxy
5. Click "Create Account"

### Method 2: Session-Based (Manual Login)

1. Create account without password:
```bash
POST http://localhost:4000/api/accounts
{
  "username": "your_instagram_username"
}
```

2. Start the bot - it will open browser for manual login
3. After login, session is saved automatically
4. Future runs will use the saved session

## Account Information Structure

### Database Fields

- `id` - Auto-generated account ID
- `username` - Instagram username (required, unique)
- `password` - Encrypted password (optional)
- `status` - Account status: `idle`, `running`, `paused`, `error`, `stopped`
- `proxy` - Proxy URL (optional, for account isolation)
- `sessionPath` - Path to saved session file (auto-generated)
- `lastActive` - Last time bot ran for this account
- `createdAt` - Account creation timestamp
- `updatedAt` - Last update timestamp

### Security Notes

1. **Passwords are encrypted** using AES-256-CBC
2. **Encryption key** is stored in `.env` as `ENCRYPTION_KEY`
3. **Never commit** `.env` file to git
4. **Generate a secure key**: `openssl rand -hex 32`
5. **If you change ENCRYPTION_KEY**, all encrypted passwords become invalid

## Managing Multiple Accounts

### Adding Multiple Accounts

You can add accounts in bulk using the API:

```bash
# Example: Add 5 accounts
for username in account1 account2 account3 account4 account5; do
  curl -X POST http://localhost:4000/api/accounts \
    -H "Content-Type: application/json" \
    -d "{\"username\": \"$username\", \"password\": \"password123\"}"
done
```

### Using Proxies

For better account isolation, assign proxies:

```bash
PUT http://localhost:4000/api/accounts/1
{
  "proxy": "http://proxy1.com:8080"
}
```

### Starting/Stopping Accounts

```bash
# Start bot for account
POST http://localhost:4000/api/accounts/1/start

# Stop bot for account
POST http://localhost:4000/api/accounts/1/stop
```

## Best Practices

1. **Use unique proxies** for each account to avoid detection
2. **Don't run too many accounts** from same IP
3. **Rotate sessions** periodically
4. **Monitor account status** regularly
5. **Use strong passwords** and keep encryption key secure
6. **Start with 1-2 accounts** to test before scaling

## Troubleshooting

### "Password not available" Error
- Add password to account via API or frontend
- Or use session-based login (create account without password, then login manually)

### "Session expired" Error
- Account needs to login again
- If password is stored, bot will auto-login
- If no password, you'll need to login manually again

### "Account already exists" Error
- Username must be unique
- Check existing accounts first

