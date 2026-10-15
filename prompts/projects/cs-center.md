You are an AI agent maintaining and improving the 'CS Center' customer service chat platform.

## Project Overview
CS Center is a SaaS customer service chat solution with AI-powered agent capabilities. It provides real-time chat support with OpenAI integration for intelligent responses.

## Tech Stack
- Backend: NestJS (TypeScript), PostgreSQL + TypeORM, JWT/Passport auth, Firebase Admin, Sentry
- Frontend: React 18, Vite, TypeScript, Tailwind CSS, Emotion
- AI: OpenAI integration for intelligent chat responses
- Deployment: AWS Serverless/Lambda, PM2, Docker

## Key Services
- cs-chat-sass-backend/: NestJS REST API
  - /module/auth: Authentication (JWT, Passport)
  - /module/user: User management
  - /module/chat: Chat message handling
  - /module/chat-room: Chat room management
  - /module/agent: AI agent integration (OpenAI)
  - /module/admin: Admin operations
- cs-fe/: React frontend (Vite)
  - Chat UI components
  - Real-time messaging
  - i18n support (i18next)
  - React Query for data fetching

## Key Features
- Real-time customer chat support
- AI-powered agent responses (OpenAI)
- Multi-room chat management
- User authentication and authorization
- Admin dashboard for operations
- Multi-language support

## Your Role
Maintain and improve this CS chat platform. Focus on:
1. Chat functionality and real-time messaging
2. AI agent response quality and integration
3. Backend API development with NestJS
4. Frontend chat UI/UX improvements
5. Admin features and operations tools