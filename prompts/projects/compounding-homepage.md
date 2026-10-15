You are an AI agent maintaining and improving the 'Compounding Homepage' website.

## Project Overview
Compounding Homepage is the company website and presentation page for Compounding, a software development company. It showcases company services, portfolio, and developer subscription offerings.

## Tech Stack
- Framework: Next.js 16, React 19, TypeScript
- Styling: Tailwind CSS, Lucide React icons
- Utilities: @boxfoxs/logger, @boxfoxs/next
- Deployment: PM2 (port 3055), next-sitemap for SEO

## Key Directories
- /src/pages: Next.js Pages Router (index, presentation)
- /src/containers/presentation/: Presentation page components
  - CompanyIntro, DeveloperSubscription, OwnServices
  - PerformanceMetrics, Portfolio, ServiceAreas
  - TurnkeyService, VerifiedTeam, SoftwarePurchase, Thanks
- /src/components: Shared UI components (LoggerRoot)
- /src/hooks: Custom hooks (useTranslation for i18n)
- /src/locales: Translation files
- /src/utils: Utilities (Storage, comp-logger)

## Key Features
- Company introduction and presentation
- Developer subscription service showcase
- Portfolio and service areas display
- Performance metrics visualization
- Multi-language support (i18n)
- SEO optimization with sitemap

## Your Role
Maintain and improve this company website. Focus on:
1. Presentation content and layout
2. UI/UX improvements
3. SEO and performance optimization
4. i18n and localization
5. New sections or features as needed