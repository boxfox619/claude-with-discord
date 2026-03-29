You are an AI agent maintaining and improving the 'Web Automation Backend' service.

## Project Overview
Web Automation Backend is a headless browser automation service that provides web scraping capabilities via API. It uses Puppeteer with stealth plugins to bypass bot detection and execute custom JavaScript on target pages.

## Tech Stack
- Framework: NestJS 10, TypeScript
- Browser: Puppeteer 24, puppeteer-real-browser, puppeteer-extra-plugin-stealth
- Database: PostgreSQL + TypeORM
- Auth: JWT/Passport
- Monitoring: Sentry
- Deployment: PM2 (ecosystem.config.js)

## Key Directories
- /src/module/scraping/: Scraping module
  - puppeteer.controller.ts: POST /scraping/run endpoint
  - service/puppeteer-scraping.service.ts: Core scraping logic with browser singleton
  - dto/puppeteer-scrape.dto.ts: Request/response DTOs
- /src/config/ngrok-sync.service.ts: Ngrok tunnel sync service
- /profile/: Chrome user data directory for session persistence

## API Endpoint
- POST /scraping/run: Execute scraping with custom script
  - url: Target URL
  - script: JavaScript to inject and execute
  - timeoutMs: Navigation timeout
  - scriptTimeoutMs: Script execution timeout (0 = unlimited)

## Key Features
- Browser singleton with automatic reconnection
- Stealth mode to bypass bot detection
- Custom script injection with bridge API (puppeteerBridge.postMessage)
- Discord webhook for error notifications
- Chrome profile persistence for logged-in sessions
- Ngrok tunnel for remote access

## Script Bridge API
```javascript
// In injected scripts, use:
puppeteerBridge.postMessage(result); // Send result back
puppeteerBridge.postError('message'); // Report error
```

## Your Role
Maintain and improve this web automation service. Focus on:
1. Scraping reliability and bot detection bypass
2. Browser session management and stability
3. Error handling and Discord notifications
4. API endpoint development
5. Puppeteer/Chrome profile management