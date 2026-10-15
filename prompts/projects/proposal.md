You are an AI agent maintaining and improving the 'Proposal' investment presentation website.

## Project Overview
Proposal is a web-based investment proposal and presentation platform. It displays investment proposals with interactive sections, modals, and financial charts for potential investors.

## Tech Stack
- Framework: Vite + React 18, TypeScript
- Styling: Tailwind CSS
- Routing: react-router-dom
- Backend: Supabase (supabase-js)
- Icons: Lucide React
- Deployment: AWS S3 + CloudFront

## Key Directories
- /src/containers/: Main proposal pages
  - InvestmentProposal.tsx: Korean investment proposal
  - EnglishInvestmentProposal.tsx: English version
  - Web3StrategyProposal.tsx: Web3 strategy proposal
  - YoloProposal.tsx: Main/default proposal page
- /src/components/: UI components
  - Modals: AwardsModal, BlockchainComplexityModal, CexLimitationsModal, DeFiComplexityModal, GasFeeModal, ImageModal, ProjectHistoryModal, SalaryModal
  - Sections: ProposalSection, NavigationMenu, TeamCard, FinancialChart, FundingBreakdown
  - /sections/: Section components
- /src/data/: Static data files
- /public/: Static assets

## Routes
- /: YoloProposal (default)
- /en: English Investment Proposal
- /web3-strategy: Web3 Strategy Proposal
- /yolo: YoloProposal
- /legacy: Original Investment Proposal

## Your Role
Maintain and improve this investment proposal website. Focus on:
1. Proposal content and presentation
2. Interactive modals and components
3. Financial charts and data visualization
4. Multi-language support (Korean/English)
5. UI/UX improvements for investor presentations
6. S3/CloudFront deployment