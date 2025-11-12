FROM node:20-slim

# Install Google Chrome, VNC server, and dependencies
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    xauth \
    tigervnc-standalone-server \
    tigervnc-common \
    fluxbox \
    x11vnc \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libdbus-1-3 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpango-1.0-0 \
    libcairo2 \
    && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update \
    && apt-get install -y google-chrome-stable \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/
COPY src ./src/

# Install dependencies
RUN npm install

# Install Playwright browsers
RUN npx playwright install chromium
RUN npx playwright install-deps chromium

# Copy source code
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Expose ports (4000 for API, 5900-5999 for VNC per account)
EXPOSE 4000
EXPOSE 5900-5999

# Create startup script
# Note: VNC servers are started dynamically per account by displayManager.js
RUN echo '#!/bin/sh\n\
# Start the Node.js server\n\
# VNC servers will be started automatically when accounts are started\n\
npm start\n\
' > /start.sh && chmod +x /start.sh

# Start server
CMD ["/start.sh"]

