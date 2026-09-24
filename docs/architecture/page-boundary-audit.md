# Testagram Page Boundary Audit

## Purpose

Pages are route-owned surfaces. A page may compose reusable feature components, but a feature that has its own navigation destination should not remain hidden inside another page's tab, modal, or controller.

## Findings at revision `a7ebcdd524e21a93e31e10a59dee29bb2dbac66d`

### Route-level surfaces already separated

- Home
- Explore
- Search
- Hashtag discovery and hashtag detail
- Discover
- Threads and thread detail
- Post detail
- Post reaction destinations
- Thread reaction destinations
- Communities and community detail
- Marketplace, product detail, seller storefront, orders
- Fediverse and federated profile
- Spaces and space detail/recording
- Videos/Shorts/watch-later
- Wallet
- Creator Studio
- Monetization/ads/admin surfaces

### High-risk page containers

| Page | Approx. source size | Boundary issue |
| --- | ---: | --- |
| `WalletPage.tsx` | 258 KB | 14 wallet surfaces plus many local UI/data controllers |
| `ProfilePage.tsx` | 144 KB | profile, creator/media/podcast-related surface logic |
| `RegulatorPanel.tsx` | 124 KB | regulator operations concentrated in one page |
| `FediversePage.tsx` | 103 KB | federation discovery, actors, posts and management surface |
| `ExplorePage.tsx` | 100 KB | discovery/search/trend/reaction/marketplace composition |
| `CommunityPage.tsx` | 90 KB | community feed plus admin/interaction concerns |
| `CreatorStudio.tsx` | 85 KB | studio workbench with multiple creator tools |
| `ProductsPage.tsx` | 68 KB | catalog plus reviews/Q&A/boost/product-card flows |
| `SpacesPage.tsx` | 66 KB | spaces discovery plus lifecycle actions |
| `MonetizationDashboard.tsx` | 57 KB | multiple monetization/reporting surfaces |
| `SettingsPage.tsx` | 56 KB | multiple independent settings domains |
| `MarketplacePage.tsx` | 52 KB | marketplace discovery and commerce controls |
| `OrdersPage.tsx` | 50 KB | order management surface with nested operational states |

## Confirmed nested surfaces

### Wallet

The wallet controller had these tab destinations:

- wallet overview
- history
- send
- receive
- analytics
- referrals
- scheduled transfers
- savings
- transaction reminders
- security
- currency converter
- savings pocket
- M-Pesa

These now have standalone route modules:

- `/wallet`
- `/wallet/history`
- `/wallet/send`
- `/wallet/receive`
- `/wallet/analytics`
- `/wallet/referrals`
- `/wallet/scheduled`
- `/wallet/savings`
- `/wallet/reminders`
- `/wallet/security`
- `/wallet/converter`
- `/wallet/pocket`
- `/wallet/mpesa`

The existing wallet controller remains the compatibility/data layer for these surfaces, but the navigation boundary is now explicit. This is an intermediate extraction step; the next phase should move each remaining tab controller into `src/features/wallet/<surface>`.

### Global app container

The interest onboarding sheet was embedded directly in `App.tsx`. It is now isolated in:

`src/components/features/InterestOnboardingSheet.tsx`

This prevents the application shell from becoming a feature implementation container.

## Existing architecture strengths

- Reaction services already have dedicated feature modules under `src/features/`.
- Post/thread reaction destinations have dedicated route page modules.
- Most heavy pages are lazy-loaded from `App.tsx`.
- Shared UI primitives are separated under `src/components/ui/`.
- Wallet, monetization, payments and federation already have service/module boundaries.

## Remaining extraction targets

1. **Wallet** — move each remaining tab controller/data state out of `WalletPage.tsx`.
2. **Explore** — separate search, trends, discovery rails, marketplace injection and reaction rendering into feature modules.
3. **Fediverse** — separate gateway/relay management, actor/profile discovery, federated feed and post interactions.
4. **Profile** — separate profile identity, creator tools, media, podcast and commerce sections.
5. **Community** — separate member/feed/admin/moderation surfaces.
6. **Creator Studio** — split asset composer, media studio, monetization and analytics workbenches.
7. **Settings** — split security/privacy, appearance, notification and account-management domains.
8. **Marketplace/Products/Orders** — split catalog, product detail operations, reviews/Q&A, seller operations and order workflows.
9. **Spaces** — split discovery, room lifecycle, live audio and recording surfaces.
10. **Admin/Regulator** — split operational domains into independently routable/admin-owned pages.

## Boundary rule going forward

A component becomes a standalone page when it has at least one of:

- its own URL destination;
- its own navigation item;
- its own data lifecycle;
- its own permission/role boundary;
- its own loading/error state;
- its own pagination/infinite-scroll lifecycle;
- a materially different purpose from its parent surface.

Modals, confirmation dialogs, compact cards and reusable controls remain components unless they have independent navigation/data ownership.

## Verification policy

Every extraction must pass:

1. TypeScript typecheck.
2. ESLint.
3. Production build.
4. Route-level smoke verification.
5. GitHub Actions status for the resulting commit.
6. Vercel deployment SHA/state before calling production-ready.
