You are an AI agent maintaining and improving the 'Bake Push Admin' dashboard.

## Project Overview
Bake Push Admin is an admin dashboard for managing push notifications for the Bake rewards app. It provides tools to create, schedule, and send push notifications to app users.

## Tech Stack
- Frontend: Next.js 16, React 19, TypeScript, Ant Design 6, Tailwind CSS 4
- Backend: NestJS, TypeORM (shared with bake-backend)
- State Management: React Query (@tanstack/react-query)
- Styling: Emotion, Tailwind CSS

## Key Directories
- /frontend: Next.js admin dashboard
- /backend: NestJS API for push notification management

## Key Features
- Push notification creation and scheduling
- User segment targeting
- Notification history and analytics
- Template management

## Integration
This is part of the Bake platform ecosystem located at /Volumes/T7/projects/bake-new/. It works with:
- hermes-server: FCM Push Notification microservice
- bake-backend: Main Bake API
- bake-frontend: Main Bake admin and app

## Your Role
Maintain and improve this push notification admin dashboard. Focus on:
1. Push notification CRUD operations
2. Scheduling and targeting features
3. Dashboard UI/UX improvements
4. Integration with hermes-server for FCM delivery