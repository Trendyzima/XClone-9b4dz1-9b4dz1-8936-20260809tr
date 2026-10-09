# XClone — Social Media App for Android, iOS Web, and Android TV

**XClone** is a social platform for short-form videos, posts and threads, live video and audio, communities, messaging, creator tools, discovery, commerce, and digital payments. The product's current public web experience is hosted at **[testagram.site](https://testagram.site/)**.

Find the right XClone experience for your device below: download the Android APK, use the web app on iPhone/iPad, or try the separate Android TV app.

[**Open XClone on the web**](https://testagram.site/) · [**Download the latest Android APK**](https://github.com/Trendyzima/XClone-9b4dz1-9b4dz1-8936-20260809tr/releases/latest) · [**Browse all releases**](https://github.com/Trendyzima/XClone-9b4dz1-9b4dz1-8936-20260809tr/releases) · [**Android TV build status**](https://github.com/Trendyzima/XClone-9b4dz1-9b4dz1-8936-20260809tr/actions)

> **Release status:** Android APK/AAB assets are published through GitHub Releases. The separate Android TV project has a successful debug-build CI path; a stable, signed public TV release and real-device validation remain release gates. See the platform table before installing.

## Download XClone for your device

| Platform | What you can use | Download / launch | Availability |
|---|---|---|---|
| **Android phones and tablets** | Android app package (APK); Android App Bundle (AAB) is provided for distribution workflows | [Latest Android release and APK](https://github.com/Trendyzima/XClone-9b4dz1-9b4dz1-8936-20260809tr/releases/latest) | APK available from GitHub Releases |
| **Android TV and Google TV** | Separate TV app package ID `com.xclone.app.tv`, with Leanback launcher and remote/D-pad support | [TV build workflow and artifacts](https://github.com/Trendyzima/XClone-9b4dz1-9b4dz1-8936-20260809tr/actions/workflows/ci.yml) · [TV project instructions](android-tv/README.md) | Debug APK builds in CI; signed public release and physical-TV validation pending |
| **iPhone and iPad (iOS/iPadOS)** | Use the responsive XClone web app in Safari; you can use Safari's Add to Home Screen feature where available | [Open XClone in Safari](https://testagram.site/) | Web experience; this repository does not currently provide a native iOS IPA or App Store listing |
| **Desktop and other browsers** | Responsive web app | [Open XClone](https://testagram.site/) | Web |
| **Desktop native client** | Tauri desktop project | [Desktop setup](desktop/README.md) | Development/build instructions in repository |

### Android APK download

1. Open the [latest XClone/Testagram Android release](https://github.com/Trendyzima/XClone-9b4dz1-9b4dz1-8936-20260809tr/releases/latest).
2. Download **`app-release.apk`** to an Android device.
3. Review the release notes and Android's installation prompts before installing.
4. Sign in to access account features that require authentication.

**Important signing note:** the current Android release workflow generates temporary CI signing material. Until a stable Android signing identity is configured and verified across releases, an APK update may not install over an APK signed with a different certificate. Back up or sync important account data and read the release notes before replacing an existing installation. Do not treat CI-generated signing as proof of a final, stable production release.

### Android TV and Google TV

The TV client is a separate Android project and package, designed to open the existing XClone web experience from a TV launcher. The current CI workflow builds and verifies a debug APK. Downloadable workflow artifacts may require a GitHub sign-in and are intended for testing, not general public distribution.

- [Build and verification workflow](https://github.com/Trendyzima/XClone-9b4dz1-9b4dz1-8936-20260809tr/actions/workflows/ci.yml)
- [TV app build instructions](android-tv/README.md)
- [TV signed-release workflow source](.github/workflows/xclone-tv-release.yml)

Remote navigation, authentication, Back behavior, and IPTV/video playback still need validation on real Android TV or Google TV hardware before the TV app can be described as a fully validated consumer release.

## What can you do with XClone?

XClone brings social networking, short videos, live experiences, communities, creator tools, discovery, and commerce into one connected product. Feature availability may depend on account permissions, configuration, integrations, and rollout status.

### Social posts, threads, and profiles
- Publish text posts, threads, replies, quote posts, reposts, and multi-image or video posts.
- Like, bookmark, follow, mention users, use hashtags, and participate in polls.
- Explore post history and profile sections for posts, replies, media, videos, likes, followers, and following.
- Use lists, notifications, search, and discovery tools to find people and conversations.

### Short videos, live video, audio, and IPTV/TV
- Watch short-form videos and browse video discovery surfaces.
- Discover live streams and supported live/recorded viewing experiences.
- Join or host Live Audio Spaces where enabled.
- Explore TV channels, TV Studio and related channel/profile experiences.
- Use the web-based TV channel and media-player surfaces; actual IPTV playback depends on the stream source, device, network, and service availability.
- The separate Android TV shell provides a TV launcher entry point and remote/D-pad navigation support.

**Playback transparency:** IPTV channel availability, start-up time, and buffering depend on live endpoints and network conditions. The repository's CI build passing does not guarantee every channel plays on every device.

### Communities and conversations
- Discover communities and community pages.
- Participate in community posts, member experiences, chat, events, and shop surfaces where enabled.
- Follow trending topics and hashtags.
- Use direct messages and notification surfaces.

### Search, trends, publishers, and federated discovery
- Discover accounts, posts, hashtags, and trending conversations.
- Browse publisher/RSS stories and article discovery surfaces.
- Explore supported Fediverse/Mastodon-oriented identities, profiles, feeds, inbox, relay, and analytics surfaces.
- Keep external publisher and federated content attributable to its original source.

### Creator Studio and monetization
- Access Creator Studio and creator overview surfaces.
- Review creator analytics, video performance, earnings and revenue information where enabled.
- Use post/story analytics and creator discovery/leaderboard surfaces.
- Explore supported monetization, advertising, promotions and creator tools.

### Wallet, payments, and commerce
- Use wallet and transaction-history surfaces.
- Explore supported send/receive, M-Pesa-related flows, referrals, savings goals, scheduled transfers, reminders and currency conversion.
- Access premium subscription and verification workflows.
- Browse marketplace, product tagging, seller storefronts, orders, wishlists, shopping mall and community shop experiences where enabled.

Payment features can require provider configuration, verification, eligibility, and supported regions. Listing a payment surface in this README does not guarantee every payment provider or transaction type is available to every account.

### Safety, privacy, and support
- Access reporting, blocking, appeals, verification, moderation and account-security surfaces.
- Review community guidelines, content policies, privacy information and terms.
- Use the Help Center for searchable help content, feedback, support requests, ticket history for authenticated users, and AI-assisted support where configured.

## Platform details

### Android app
The existing Android project lives in `android/`. The production WebView shell uses the mobile application ID `com.xclone.app`.

- [Android release workflow](.github/workflows/android-release.yml)
- [All GitHub releases](https://github.com/Trendyzima/XClone-9b4dz1-9b4dz1-8936-20260809tr/releases)
- [Latest APK download](https://github.com/Trendyzima/XClone-9b4dz1-9b4dz1-8936-20260809tr/releases/latest)

### Android TV app
The TV project lives in `android-tv/` and uses `com.xclone.app.tv`, separate from the mobile package. It reuses the existing web experience rather than duplicating IPTV catalogue, stream-selection, buffering, or playback services.

- [TV README](android-tv/README.md)
- [TV release workflow](.github/workflows/xclone-tv-release.yml)
- [GitHub Actions runs](https://github.com/Trendyzima/XClone-9b4dz1-9b4dz1-8936-20260809tr/actions)

### iPhone and iPad
Open [testagram.site](https://testagram.site/) in Safari. The site includes web-app metadata and an Apple touch icon, but this repository does **not** currently contain a native iOS application project or an IPA download. This README therefore does not claim an App Store release.

## Product architecture

```text
Web browser / Android WebView / Android TV WebView
                    |
             React + TypeScript
                    |
      Routes, social UI, media and feature surfaces
                    |
       Supabase Auth / PostgreSQL / Storage
             / Realtime / Edge Functions
                    |
     Media and IPTV delivery / live experiences
        / publisher and Fediverse integrations
          / payment and monetization services
```

The repository contains a React + TypeScript application using Vite, Tailwind CSS, route-level lazy loading and Supabase. It also contains a separate Android TV project, the existing Android project, a Flutter mobile foundation, a Tauri desktop client, and first-party media/backend services.

The checked-in repository and deployed configuration are authoritative for the exact production service topology. Some feature screens integrate with external providers and may require separate service configuration.

## Technology stack

| Area | Technology |
|---|---|
| Web UI | React 18, TypeScript, React Router |
| Build | Vite |
| Styling and components | Tailwind CSS, Radix UI, shadcn-style components |
| Data and state | TanStack Query, Redux Toolkit/Zustand where used |
| Backend and database | Supabase, PostgreSQL |
| Authentication | Supabase Auth |
| Realtime and storage | Supabase Realtime and Storage |
| Edge/serverless | Supabase Edge Functions and API handlers |
| Video | HLS.js and application media-player surfaces |
| Live media | WebRTC / Testagram Media Engine integrations |
| Android | Existing Android/Capacitor project |
| Android TV | Separate Android application project |
| Mobile migration foundation | Flutter under `mobile/` |
| Desktop | Tauri |
| Analytics and charts | PostHog integration, Recharts, Chart.js |
| Maps | Leaflet / React Leaflet |
| Deployment | Vercel-oriented production pipeline and GitHub Actions |

## Repository layout

```text
.
├── src/                  # React application, components, hooks and pages
├── android/              # Existing Android app; keep separate from TV package
├── android-tv/           # Separate Android TV app and build instructions
├── mobile/               # Flutter mobile migration foundation
├── desktop/              # Tauri desktop client
├── supabase/             # Database migrations and Edge Functions
├── services/              # First-party backend and media services
├── api/                   # API/serverless handlers
├── public/                # Static assets, manifests and public metadata
├── docs/                  # Architecture and operations documentation
├── ops/                   # Operational tooling
├── scripts/               # Build and maintenance scripts
└── .github/workflows/     # CI, Android release and TV release workflows
```

## Run the web application locally

### Prerequisites
Use a current Node.js LTS version and npm compatible with the repository lockfile.

```bash
npm ci
npm run dev
```

### Validate and build

```bash
npm run typecheck
npm run lint
npm run build
npm run preview
```

## Environment configuration

See `.env.example` for the browser-facing example configuration. Typical client settings include:

```env
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
VITE_POSTHOG_KEY=
VITE_POSTHOG_HOST=https://us.i.posthog.com
```

Never place Supabase service-role keys, payment secrets, private API credentials, or other privileged values in client-side Vite variables. Privileged operations belong on trusted server infrastructure.

## Performance, reliability, and security principles

- Lazy-load route-level pages and request secondary datasets only when needed.
- Use pagination for long feeds and caching for suitable short-lived external data.
- Treat live streams differently from uploaded media; transient live content should not automatically become permanent storage.
- Provide clear loading, empty, success and error states; never disguise a backend failure as success.
- Enforce authorization server-side and with appropriate database row-level security.
- Treat RSS, federated, uploaded and user-generated content as untrusted input.
- Keep privileged credentials server-side and protect payment, moderation, administration and account operations with authorization.
- Validate the exact commit through CI and check deployment status separately from build status.

## CI and release validation

A successful workflow confirms only the checks actually executed by that workflow. It does not independently prove that every production route, IPTV channel, payment provider, or device combination works.

- [GitHub Actions workflows](https://github.com/Trendyzima/XClone-9b4dz1-9b4dz1-8936-20260809tr/actions)
- [Published releases](https://github.com/Trendyzima/XClone-9b4dz1-9b4dz1-8936-20260809tr/releases)
- [Android TV project](android-tv/README.md)

Before promoting a build to general users, verify the signing identity across versions, install and upgrade behavior, login/session persistence, Back navigation, video playback, IPTV playback, and the target device class.

## SEO and discoverability

This README intentionally describes the product in natural language so users and search engines can understand the supported platform paths and feature areas. Relevant search topics include:

- XClone social media app and Android APK
- XClone short videos, reels-style video feed, posts and communities
- XClone Android TV and Google TV app
- Social networking, live video, live audio and IPTV/TV channel experiences
- Creator Studio, creator analytics and monetization
- Social messaging, trending topics and federated discovery
- Wallet, M-Pesa-related flows, marketplace and community shops
- XClone web app for iPhone, iPad, Android and desktop browsers

These phrases describe product areas; they are not a promise that every integration is enabled for every user or that a native iOS app is published. Avoid keyword stuffing and keep the README aligned with real release availability.

## Support and policies

Open the [XClone web app](https://testagram.site/) to access the in-product Help Center and available policy pages. Repository-level documentation is in `docs/`.

## License

No open-source license is currently declared in this repository. Do not assume the code is freely redistributable or reusable unless a license is explicitly added.

---

**XClone** — social publishing, short videos, live experiences, communities, creator tools, and connected experiences across the web, Android, and Android TV.
