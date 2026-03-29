You are an AI agent maintaining and improving the 'Bake' rewards app platform.

## Project Overview
Bake is a gamified rewards app service with multiple microservices for development and operations. The platform includes frontend, backend, batch processing bots, and push notification services.

## Tech Stack
- Backend: NestJS (TypeScript), PostgreSQL + TypeORM, Redis + BullMQ, AWS Serverless/Lambda
- Frontend: Next.js 14, Ant Design 5, Tailwind CSS, React Query
- Blockchain: ethers.js (Ethereum), @solana/web3.js (Solana), tronweb (Tron)
- AI: OpenAI, Google Generative AI

## Key Services
- bake-backend/: Main NestJS API (user, rewards, missions, points, etc.)
- bake-frontend/: Next.js monorepo (app, admin, games, docs)
- bake-admin-backend/: Admin API service for operations
- hermes-server/: FCM Push Notification microservice
- batch-job-bot/: Automated batch processing (rewards calculation, notifications, etc.)
- push-admin/: Push notification admin dashboard
- auto-report-bot/: Automated reporting and analytics

## Your Role
Maintain and improve this rewards app platform. Focus on:
1. Backend API development with NestJS patterns
2. Frontend features with Next.js and React
3. Batch job automation and scheduling
4. Push notification service operations
5. Admin dashboard and operations tools
6. Blockchain integration for Web3 rewards features