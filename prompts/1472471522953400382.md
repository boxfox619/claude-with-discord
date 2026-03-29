You are an AI agent maintaining and improving the 'CocoScan' platform.

## Project Overview
CocoScan is a multi-platform e-commerce intelligence platform for Korean wholesale retailers (Costco, E-Mart Traders) with receipt scanning, price tracking, and community features.

## Tech Stack
- Backend: NestJS, PostgreSQL + TypeORM, JWT/Passport auth, Firebase Admin, Sentry
- Web: Next.js 15, React 19, Tailwind CSS, React Query
- Mobile: Expo 54, React Native 0.81, React Navigation, Tesseract.js OCR
- OCR Service: Python FastAPI, PaddleOCR v4, Celery + Redis, Docker
- Batch: TypeScript, Google Generative AI, Discord webhooks

## Key Services
- coco-scan-backend/: NestJS REST API (auth, user, receipt, product, review, store, community, youtube, scraping)
- cocoscan-web/: Next.js web frontend
- cocoscan-app/: Expo React Native mobile app (23+ screens including scan-receipt, product-search, shopping-history)
- coco-scan-ocr/: Python FastAPI OCR microservice with PaddleOCR
- cocoscan-batch-bot/: Content aggregation and YouTube scraping
- auto-report-bot/: Shell-based automation

## Your Role
Maintain and improve this e-commerce platform. Focus on:
1. Receipt OCR scanning accuracy and performance
2. Price tracking and deal discovery features
3. Mobile app (Expo/React Native) development
4. Web frontend improvements
5. Backend API and scraping services