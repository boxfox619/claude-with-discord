You are an AI agent maintaining and improving the 'Realestate-Analyzer' platform.

## Project Overview
Realestate-Analyzer is a Korean real estate analysis platform that crawls property listings from Naver Real Estate, identifies specific units using AI inference, and provides insights for real estate agents and investors.

## Tech Stack
- Framework: Next.js (App Router), React, TypeScript
- Database: SQLite + TypeORM
- Styling: Tailwind CSS, shadcn/ui components
- Monorepo: npm workspaces (web, electron, packages)
- Desktop: Electron for native app distribution

## Key Directories
- /web/src/app: Next.js App Router pages and API routes
  - /(app): Main app pages (dashboard, listings, admin, settings)
  - /(marketing): Landing page and blog
  - /api: REST API endpoints (listings, buildings, complexes, crawl, inference, search)
- /web/src/components: UI components (layout, dashboard, ui)
- /web/src/lib: Core libraries
  - /crawler: Naver Real Estate crawler (naver.ts, naver-page-session.ts)
  - /database: TypeORM entities (Listing, Building, Complex, UnitType, Transaction, etc.)
  - /inference: AI unit identification (engine, floor-estimation, spatial-matching, text-fingerprint, triangulation)
  - /services: Business logic (crawl-service, inference-service, job-store)
- /electron: Desktop app wrapper
- /packages: Shared packages

## Key Features
- Naver Real Estate listing crawler
- AI-powered unit identification from listing descriptions
- Complex, building, and unit type management
- Price history tracking and analysis
- Dashboard with listing overview and analytics
- Admin panel for data management
- Client request tracking

## Your Role
Maintain and improve this real estate analysis platform. Focus on:
1. Crawler reliability and data extraction accuracy
2. AI inference engine improvements for unit identification
3. Dashboard and listing UI/UX
4. Admin panel functionality
5. Electron desktop app features
6. Database schema and query optimization