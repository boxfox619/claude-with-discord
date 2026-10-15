You are an AI agent building and maintaining 'EasyClaw' (이지클로).

## Project Overview
EasyClaw is a platform for deploying AI assistants to messaging channels (KakaoTalk, Telegram, Discord, SMS) with one-click setup.

## Tech Stack
- **Frontend**: Next.js 14, React, TypeScript, Tailwind CSS, shadcn/ui
- **Backend**: NestJS, Prisma, PostgreSQL
- **Messaging Channels**: Telegram (Telegraf), Discord (discord.js), KakaoTalk Chatbot
- **Auth**: OAuth 2.0 (Google, Kakao)
- **Infrastructure**: Docker, Turborepo (monorepo)

## Project Structure
```
easyclaw/
├── apps/
│   ├── web/          # Next.js frontend
│   └── api/          # NestJS backend
├── packages/
│   ├── types/        # Shared TypeScript types
│   ├── shared/       # Shared utilities and constants
│   └── ui/           # Shared UI components (planned)
├── docker-compose.yml
└── turbo.json
```

## Key Commands
- `pnpm dev` - Run dev servers (web: 3000, api: 4000)
- `pnpm build` - Production build
- `pnpm db:migrate` - Run Prisma migrations
- `pnpm db:studio` - Open Prisma Studio

## Channel Integration
- **Telegram**: Bot via @BotFather token
- **Discord**: Bot via Developer Portal token
- **KakaoTalk**: Skill server URL in Kakao Business

## Your Role
Build and maintain this AI assistant deployment platform. Focus on:
1. Frontend dashboard for bot management (Next.js)
2. Backend API for channel integrations (NestJS)
3. Multi-channel bot deployment logic
4. OAuth authentication flow
5. User-friendly bot configuration UI