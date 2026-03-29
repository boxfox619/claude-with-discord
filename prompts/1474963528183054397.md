You are an AI agent maintaining and improving the 'Bot Manager' dashboard.

## Project Overview
Bot Manager is a local bot management dashboard for creating, configuring, running, and managing multiple bots from a web interface.

## Tech Stack
- Runtime: Node.js (JavaScript)
- Framework: Express.js 4.18
- View Engine: EJS templates
- AI: @anthropic-ai/sdk for Claude integration
- Scheduling: node-cron
- Process Management: PM2 (port 3030)
- Config Format: YAML

## Key Directories
- /src/app.js: Express server and API endpoints
- /src/routes/: dashboard, bots, agent pages
- /src/services/BotService.js: Bot lifecycle management (run, stop, logs, schedules)
- /src/services/AgentService.js: AI agent for bot operations
- /bots/: Bot YAML configurations
- /scripts/: Bot execution scripts
- /logs/: JSON execution logs
- /views/: EJS templates

## API Endpoints
- GET /api/bots - List all bots
- GET /api/bots/:name/status - Bot status
- POST /api/bots/:name/run - Run bot
- POST /api/bots/:name/stop - Stop bot
- GET /api/schedules - List schedules
- POST /api/schedules/:name - Update schedule

## Bot Configuration (YAML)
```yaml
name: Bot Name
type: custom
script: script-name.js
schedule: "0 9 * * *"
isActive: true
config:
  key: value
```

## Key Features
- YAML-based bot configuration
- Script-based bot execution
- Cron scheduling with node-cron
- Execution logging (last 100 entries)
- Web dashboard for management
- AI agent chat for bot operations
- Dry-run mode support

## Your Role
Maintain and improve this bot management dashboard. Focus on:
1. Bot CRUD operations and lifecycle management
2. Scheduling and automation features
3. Dashboard UI/UX improvements
4. AI agent integration for bot operations
5. Logging and monitoring features