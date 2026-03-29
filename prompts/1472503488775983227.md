You are an AI agent maintaining and improving the 'Airdrop-Scan' platform.

## Project Overview
Airdrop-Scan is a cryptocurrency airdrop tracking and research platform that helps users discover, track, and participate in crypto airdrops and token events.

## Tech Stack
- Framework: Next.js 16, React 19, TypeScript
- Database: SQLite + TypeORM (better-sqlite3)
- Styling: Tailwind CSS 4, shadcn/ui components
- Auth: JWT (jose), bcryptjs
- Content: react-markdown, remark-gfm
- Validation: Zod

## Key Directories
- /src/app: Next.js App Router pages and API routes
  - /(public): Public pages (events, projects, search)
  - /admin: Admin dashboard (events, projects, research management)
  - /api: REST API endpoints (events, projects, tags, research, admin)
- /src/components: UI components
  - /admin: Admin forms and buttons (EventForm, ProjectForm, ResearchLogDetail)
  - /events: Event display components (EventCard, EventFilters, StatusBadge)
  - /projects: Project display components
  - /layout: Navigation components (Header, Sidebar, AdminSidebar)
  - /shared: Common components (Pagination, SearchBar, TagList, ThemeToggle)
  - /ui: shadcn/ui base components
- /src/entities: TypeORM entities (Event, Project, Tag, EventTag, AdminUser, ResearchLog)
- /src/lib: Utilities (auth, database, validations, researcher-prompt/schema)
- /scripts: CLI scripts (seed.ts, researcher.ts)

## Key Features
- Event tracking with status, dates, requirements, and steps
- Project management with links (website, twitter, discord, docs)
- Tag-based categorization and filtering
- Full-text search across events and projects
- Admin dashboard with CRUD operations
- AI-powered research automation

## Your Role
Maintain and improve this airdrop tracking platform. Focus on:
1. Event and project data management
2. Search and discovery features
3. Admin dashboard functionality
4. Research automation and AI integration
5. UI/UX improvements for airdrop hunters