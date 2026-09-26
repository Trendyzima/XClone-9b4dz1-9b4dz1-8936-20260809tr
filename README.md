# Testagram

A production-oriented social platform for short-form video, conversations, communities, live audio/video, creator tools, commerce, payments, federated discovery, publisher feeds, and support.

> **Status:** Active development and production hardening

## What is Testagram?

Testagram is a responsive social ecosystem built around user publishing and discovery. It brings together social posts and threads, short-form video, communities, live experiences, creator tools, monetization, wallet/payment flows, commerce, Fediverse discovery, publisher/RSS content, and an in-product Help Center.

The repository is a React + TypeScript application using Vite, Tailwind CSS, Supabase, serverless integrations, and route-level lazy loading. Production changes are validated through automated quality and deployment workflows.

## Product capabilities

### Social publishing
- Posts, threads, replies, quote posts, reposts, likes, bookmarks, polls, hashtags, mentions, and post history.
- Multi-image posts and video publishing.
- Dedicated profile surfaces for posts, threads, replies, media, videos, likes, followers, and following.
- Lists, history, notifications, direct messages, search, and discovery.
- Responsive mobile navigation and desktop sidebars.

### Video, live, audio & TV
- Short-form video viewing.
- Live streaming and live-stream discovery.
- Live Audio Spaces.
- TV Studio, TV channels, and channel profile experiences.
- Dedicated live/recording viewing surfaces where supported.

### Communities
- Community discovery and community pages.
- Community posts, members, chat, events, and shop experiences.
- Trending topics and hashtag discovery.

### Fediverse
- Federated discovery, profiles, feeds, identities, inbox, relay, analytics, and Mastodon-oriented surfaces.
- Organic federated content can participate in the home discovery experience.
- Federated content remains attributable to its originating service.

### Publisher and RSS feeds
- Publisher/RSS ingestion and article discovery.
- Publisher stories are blended into the native home feed rather than forced into a separate top-of-page news rail.
- Publisher cards can display publisher identity, favicon, category, imagery, excerpt, timestamp, and article context.
- RSS requests use short-lived frontend caching to reduce repeated network traffic.
- Transient external/live media is not automatically converted into permanent backend video storage.

### Creator tools
- Creator Studio and creator overview.
- Creator analytics, videos, earnings, and revenue surfaces.
- Post and story analytics.
- Creator leaderboards and related discovery surfaces.
- Monetization and advertising tools.

### Payments, wallet & commerce
- Wallet dashboard and transaction history.
- Send/receive money, M-Pesa-related flows, referrals, savings, scheduled transfers, reminders, security, and currency conversion.
- Premium subscriptions and verification workflows.
- Payout and revenue surfaces.
- Product tagging, marketplace, shopping mall, seller storefronts, orders, wishlists, and community shops.

### Safety, trust & support
- Reporting, blocking, appeals, verification, fraud/admin tooling, and moderation surfaces.
- Content policy, community guidelines, privacy policy, and terms.
- Active session and account-security surfaces.
- Help Center with searchable articles, article feedback, support requests, authenticated ticket history, video-guide placeholders, and AI-assisted support.

## Architecture

~~~text
Browser
  |
  +-- React 18 + TypeScript
  +-- React Router
  +-- Tailwind CSS + Radix/shadcn-style UI
  +-- TanStack Query / application state
  +-- Lazy-loaded route surfaces
  |
  +-- Supabase
  |     +-- PostgreSQL
  |     +-- Auth
  |     +-- Storage
  |     +-- Realtime
  |     +-- Edge Functions
  |
  +-- Publisher/RSS services
  +-- Fediverse integrations
  +-- LiveKit live media
  +-- Payment/monetization integrations
  +-- Analytics/observability
~~~

The repository configuration and deployed environment are authoritative for the exact production topology.

## Technology stack

| Area | Technology |
|---|---|
| UI | React 18 + TypeScript |
| Build | Vite |
| Styling | Tailwind CSS |
| UI primitives | Radix UI / shadcn-style components |
| Routing | React Router |
| Backend | Supabase |
| Database | PostgreSQL |
| Authentication | Supabase Auth |
| Realtime | Supabase Realtime |
| Storage | Supabase Storage |
| Serverless | Supabase Edge Functions / API routes |
| Live media | LiveKit Client |
| Data fetching | TanStack Query |
| Charts | Recharts / Chart.js |
| Maps | Leaflet / React Leaflet |
| Animation | Framer Motion |
| Forms | React Hook Form + resolver integrations |
| Analytics | PostHog integration |
| Deployment | Vercel-oriented production pipeline |
| Native shell | Capacitor configuration and Android project |

## Repository layout

~~~text
.
├── src/                 # React application
│   ├── components/     # Shared UI, layout, and feature components
│   ├── hooks/          # Reusable React hooks
│   ├── lib/            # Clients and utilities
│   ├── pages/          # Route-level product surfaces
│   ├── services/       # Application services
│   └── theme/          # Appearance/theme handling
├── supabase/            # Migrations and Edge Functions
├── api/                 # API/serverless handlers
├── public/              # Static assets and public metadata
├── android/             # Android/Capacitor project
├── docs/                # Documentation
├── ops/                 # Operational tooling
├── repair/              # Recovery/repair tooling
├── scripts/             # Build and maintenance scripts
├── .github/workflows/   # CI and production workflows
├── _build.cjs           # Production build wrapper
├── vercel.json          # Vercel configuration
├── vite.config.cjs      # Vite configuration
├── tailwind.config.js   # Tailwind configuration
├── tsconfig.json        # TypeScript configuration
└── package.json         # Dependencies and scripts
~~~

## Getting started

### Prerequisites

Use a current Node.js LTS release and npm compatible with the repository lockfile.

Install dependencies:

~~~bash
npm ci
~~~

Start development:

~~~bash
npm run dev
~~~

Run TypeScript validation:

~~~bash
npm run typecheck
~~~

Run lint:

~~~bash
npm run lint
~~~

Build for production:

~~~bash
npm run build
~~~

Preview the production build:

~~~bash
npm run preview
~~~

## Environment configuration

The browser-facing example configuration is provided in .env.example.

Typical client configuration:

~~~env
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
VITE_POSTHOG_KEY=
VITE_POSTHOG_HOST=https://us.i.posthog.com
~~~

A legacy VITE_SUPABASE_ANON_KEY variable may be supported during migration where documented by the application.

**Never put service-role keys, payment secrets, private API credentials, or other privileged secrets into Vite client-side variables.**

## Backend and data

Supabase provides the primary backend services:

- PostgreSQL database
- Authentication
- Row Level Security
- Storage
- Realtime subscriptions
- Edge Functions

Database changes should use migrations and be reviewed for authorization, ownership, indexes, performance, backward compatibility, and data retention.

Privileged operations belong on trusted server-side infrastructure.

## Production engineering standards

### Performance
- Lazy load route-level pages.
- Load secondary datasets only when they are needed.
- Use cursor-based pagination for long feeds.
- Cache short-lived external feed requests.
- Optimize images and media delivery.
- Avoid permanently storing transient live-stream media unless recording is explicitly required.

### Reliability
- Treat optional integrations as independently failure-prone.
- Provide explicit loading, empty, success, and error states.
- Do not turn backend failures into success-looking UI.
- Retry safe transient operations.
- Verify the exact commit SHA throughout CI and deployment.
- Treat CI success and production deployment success as separate checks.

### Security
- Enforce authorization server-side and with RLS.
- Validate untrusted input at trust boundaries.
- Keep privileged credentials server-side.
- Treat RSS, Fediverse, uploaded, and user-generated content as untrusted.
- Safely handle external URLs and media.
- Protect payment, moderation, administration, and account operations with appropriate authorization.

### UX and accessibility
- Mobile-first responsive design.
- Keyboard/focus support and accessible labels.
- Consistent touch targets and interactive states.
- Clear destructive-action confirmation.
- Useful loading, empty, and error states.
- Internal product navigation stays inside Testagram wherever possible.

## Quality gates and deployment

Local validation:

~~~bash
npm run typecheck
npm run lint
npm run build
~~~

Production readiness requires more than a local build. Verify:

1. The intended commit SHA is being tested.
2. Typecheck passes.
3. Lint passes.
4. The production build passes.
5. Relevant contract/quality workflows pass.
6. Deployment reconciliation completes.
7. The deployed application corresponds to the intended revision.
8. A browser smoke test covers affected critical routes.
9. Runtime console and chunk-loading errors are absent on affected flows.

GitHub Actions in this repository provide automated quality and operational gates. Deployment status should always be checked against the exact revision being released.

## Data and content boundaries

Testagram may display content from several sources: Testagram users, communities, federated services, and external publishers.

These sources have different ownership and trust boundaries. External publisher and federated material should remain clearly attributable to its origin and must not be represented as original Testagram-authored content.

Live media has a different lifecycle from uploaded media: a broadcaster can provide content while online, while transient live content should not automatically become permanent backend storage.

## Help and support

The in-product Help Center is available at:

/help

It provides:
- Searchable help articles
- Article feedback
- Video-guide entry points
- Support request submission
- Authenticated support-ticket history
- AI-assisted support
- Links to privacy, terms, and community-policy resources

## Development workflow

1. Reproduce the issue or define the intended behavior.
2. Inspect the relevant route, component, service, database contract, and workflow.
3. Fix the underlying cause rather than masking symptoms.
4. Check for stale imports, dead UI, duplicate logic, broken navigation, and inconsistent states.
5. Run typecheck, lint, and production build.
6. Inspect CI against the exact commit SHA.
7. Verify deployment status and revision lineage.
8. Browser-test the affected user journey.
9. Document meaningful architectural or operational changes.

## Product direction

Current engineering priorities include:

- Incremental and fast feed loading.
- Reliable RSS/publisher and Fediverse ingestion.
- Efficient live audio/video experiences.
- Creator and monetization workflows.
- Wallet, payment, and commerce reliability.
- Strong privacy, safety, moderation, and support tooling.
- Production-grade CI/CD and deployment verification.
- Reducing unnecessary backend storage and external-service cost.
- Maintaining a coherent UX as the product surface expands.

## Contributing

Before submitting changes:

- Keep TypeScript clean and avoid unnecessary any types.
- Reuse shared components and hooks.
- Follow established Tailwind and UI conventions.
- Keep route components lazy-loadable where appropriate.
- Add loading, error, and empty states.
- Never introduce client-side secrets.
- Test affected flows on mobile and desktop.
- Check the exact Git commit and deployment generated by the change.

## License

No open-source license is currently declared in this repository. Unless a license is explicitly added, do not assume the source is freely redistributable or reusable.

---

**Testagram — social publishing, communities, live experiences, creator tools, discovery, commerce, and support in one ecosystem.**
