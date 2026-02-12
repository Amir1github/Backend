# AliControl Platform

## Overview

AliControl is an enterprise-grade SaaS platform for building, training, and deploying custom AI assistants. The platform enables users to create AI assistants through either manual configuration or AI-powered interviews, manage their deployment across multiple channels (Telegram, WhatsApp, Web Widget, REST API), and access a marketplace of pre-built assistant templates.

The application follows a full-stack TypeScript architecture with a React frontend, Express backend, and PostgreSQL database using Drizzle ORM.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18+ with TypeScript
- **Styling**: Tailwind CSS with custom design tokens defined in CSS variables
- **UI Components**: shadcn/ui component library (New York style) with Radix UI primitives
- **State Management**: React Query for server state, React useState for local state
- **Build Tool**: Vite with custom path aliases (`@/` for client/src, `@shared/` for shared code)

### Backend Architecture
- **Framework**: Express.js with TypeScript
- **API Pattern**: RESTful JSON API with `/api/` prefix
- **AI Integration**: Google Gemini API via Replit's AI Integrations service
  - Uses `@google/genai` SDK with custom base URL configuration
  - Supports models: gemini-2.5-flash, gemini-2.5-pro, gemini-2.5-flash-image
- **Development**: Vite dev server with HMR integration via custom middleware
- **Production**: esbuild bundling with selective dependency inlining

### Data Storage
- **Database**: PostgreSQL with Drizzle ORM
- **Schema Location**: `shared/schema.ts` - shared between frontend and backend
- **Key Tables**: users, assistants, conversations, messages
- **Migrations**: Drizzle Kit with `db:push` command
- **Fallback**: In-memory storage implementation available in `server/storage.ts`

### Multi-language Support
- Built-in internationalization with Russian and English
- Translation system via `translations.ts` with `getTranslation()` helper

### Replit Integrations
The `server/replit_integrations/` directory contains pre-built modules:
- **batch/**: Batch processing utilities with rate limiting and retry logic
- **chat/**: Conversation and message CRUD with AI response generation
- **image/**: Image generation using Gemini's multimodal capabilities

## External Dependencies

### AI Services
- **Google Gemini API**: Primary AI backend accessed via Replit AI Integrations
  - Environment variables: `AI_INTEGRATIONS_GEMINI_API_KEY`, `AI_INTEGRATIONS_GEMINI_BASE_URL`
  - Used for: Chat responses, assistant interviews, website crawling, content synthesis

### Database
- **PostgreSQL**: Primary data store
  - Connection via `DATABASE_URL` environment variable
  - Session storage via `connect-pg-simple`

### Third-Party Integrations (Configurable)
- **Telegram**: Bot integration with token-based authentication
- **WhatsApp Business API**: Phone number and token configuration
- **Web Widget**: Embeddable chat widget with domain whitelisting
- **REST API**: Direct API access for custom integrations

### Key NPM Packages
- `drizzle-orm` / `drizzle-kit`: Database ORM and migrations
- `@tanstack/react-query`: Server state management
- `@radix-ui/*`: Accessible UI primitives
- `class-variance-authority`: Component variant management
- `zod` / `drizzle-zod`: Schema validation

## Recent Changes (January 2026)

### Backend API
- Added full REST API for assistant CRUD operations with Zod validation
- All AI calls routed through secure backend endpoints (no client-side API key exposure)
- Protected endpoints: `/api/assistants`, `/api/assistants/:id/chat`, `/api/ai/interview`, `/api/ai/synthesize`, `/api/ai/crawl`
- Public endpoints: `/api/public/assistants/:id` (info), `/api/public/assistants/:id/chat` (chat without auth)

### Security
- All Gemini API calls use Replit AI Integrations environment variables
- Request validation using Zod schemas (insertAssistantSchema, updateAssistantSchema)
- PATCH endpoint strips id/createdAt to prevent data corruption
- User authentication via Replit Auth (OIDC) with session storage in PostgreSQL
- User isolation: Each user only sees their own assistants

### Features
- Architecture documentation page showing system components and data flow
- Integrations page for connecting assistants to Telegram, WhatsApp, Web Widget, REST API
- Marketplace with pre-built assistant templates
- Multi-language support (Russian/English)
- Real-time chat interface with AI-powered responses
- **Shareable Assistant URLs**: Each assistant has a unique public URL (`/chat/:id`) for sharing
- **Embeddable Widget**: Web Widget integration provides embed code for adding chat to any website (`/embed/:id`)