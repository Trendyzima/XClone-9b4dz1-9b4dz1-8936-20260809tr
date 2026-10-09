# XClone — Social Media App for Android, iOS Web, and Android TV

**XClone** is a social platform for short-form videos, posts and threads, live video and audio, communities, messaging, creator tools, discovery, commerce, and digital payments. The product's current public web experience is hosted at **[testagram.site](https://testagram.site/)**.

Find the right XClone experience for your device below: download the Android APK, use the web app on iPhone/iPad, or try the separate Android TV app.

[**Open XClone on the web**](https://testagram.site/) · [**Download the latest Android APK**](https://github.com/Trendyzima/XClone-9b4dz1-9b4dz1-8936-20260809tr/releases/latest) · [**Browse all releases**](https://github.com/Trendyzima/XClone-9b4dz1-9b4dz1-8936-20260809tr/releases) · [**Android TV build status**](https://github.com/Trendyzima/XClone-9b4dz1-9b4dz1-8936-20260809tr/actions)

> **Release status:** Android APK/AAB assets are published through GitHub Releases. The separate Android TV project has a successful debug-build CI path; a stable, signed public TV release and real-device validation remain release gates. See the platform table before installing.

## Get XClone for your device

Choose the download that matches your device. **Android phone/tablet builds are published as release assets. Android TV is still in testing. iPhone and iPad users can use the web app; there is no native iOS download in this repository.**

| Platform | Best way to get XClone | Availability |
|---|---|---|
| **Android phone or tablet** | **[Download the latest APK](https://github.com/Trendyzima/XClone-9b4dz1-9b4dz1-8936-20260809tr/releases/latest/download/app-release.apk)** · [View release notes and all assets](https://github.com/Trendyzima/XClone-9b4dz1-9b4dz1-8936-20260809tr/releases/latest) · [AAB for distribution](https://github.com/Trendyzima/XClone-9b4dz1-9b4dz1-8936-20260809tr/releases/latest/download/app-release.aab) | APK and AAB are attached to published Android releases |
| **Android TV / Google TV** | [Inspect TV build runs](https://github.com/Trendyzima/XClone-9b4dz1-9b4dz1-8936-20260809tr/actions/workflows/ci.yml) · [TV setup guide](android-tv/README.md) | CI debug APK for testing; signed public TV release and real-device validation are not complete |
| **iPhone / iPad** | **[Open XClone in Safari](https://testagram.site/)** | Responsive web app; no native iOS IPA or App Store listing is published from this repository |
| **Desktop / other browsers** | [Open XClone](https://testagram.site/) | Web app |
| **Native desktop client** | [Desktop setup and development](desktop/README.md) | Project source and development instructions |

### Android: download and install

1. Tap **[Download the latest XClone APK](https://github.com/Trendyzima/XClone-9b4dz1-9b4dz1-8936-20260809tr/releases/latest/download/app-release.apk)** on your Android phone or tablet.
2. When the download completes, open the APK and follow Android's installation prompts. If Android asks, allow installation from the browser or file manager you used to download it.
3. Open XClone and sign in to use account features that require authentication.
4. For the version number, release notes, and alternative assets, use the [latest release page](https://github.com/Trendyzima/XClone-9b4dz1-9b4dz1-8936-20260809tr/releases/latest).

**Before upgrading:** the current Android release workflow uses temporary CI signing material. Builds signed with different certificates may not install as in-place updates over each other. Do not uninstall an existing app unless you understand the impact on locally stored data; check the release notes and confirm your account data is available before replacing an installation. A published APK is not, by itself, evidence of a stable signing identity or Play Store approval.

### Android TV and Google TV: testing build

XClone TV is a separate Android app (**com.xclone.app.tv**) that opens the existing web experience and provides a TV launcher entry point with remote/D-pad navigation support. It is **not yet advertised as a production-ready TV release**.

- [View CI builds and available artifacts](https://github.com/Trendyzima/XClone-9b4dz1-9b4dz1-8936-20260809tr/actions/workflows/ci.yml) — artifacts are temporary, may require GitHub sign-in, and are intended for testers.
- [Read the TV build instructions](android-tv/README.md).
- [Review the TV signed-release workflow](.github/workflows/xclone-tv-release.yml).

The automated TV APK build passed in [Testagram CI run #37918010514](https://github.com/Trendyzima/XClone-9b4dz1-9b4dz1-8936-20260809tr/actions/runs/37918010514). That confirms the build and its verification steps, **not** physical-device compatibility. Remote focus order, login/session persistence, Back behavior, video playback, and IPTV playback still require testing on actual Android TV or Google TV hardware before a public TV release can be called fully validated.

### iPhone and iPad: use XClone on the web

Open **[testagram.site](https://testagram.site/)** in Safari and sign in. If you want an icon on your Home Screen, use Safari's **Share → Add to Home Screen** option when available on your device.

This is the responsive web experience—not a native iOS app. This repository currently has no published IPA, native iOS project release, or App Store listing.

### Desktop

Use [XClone in your browser](https://testagram.site/) for the web experience. Developers interested in the native desktop project can follow the [Tauri desktop instructions](desktop/README.md).
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

## Build and release verification

**Current result:** the automated checks for the README/platform update completed successfully on 9 October 2026. This is a code/build result, not a claim that every feature or device has been manually tested.

| Check | Result | Evidence |
|---|---|---|
| Web build and checks | Passed | [Testagram CI](https://github.com/Trendyzima/XClone-9b4dz1-9b4dz1-8936-20260809tr/actions/runs/37918010514) |
| Android TV debug APK build and verification | Passed in CI | [TV build job in Testagram CI](https://github.com/Trendyzima/XClone-9b4dz1-9b4dz1-8936-20260809tr/actions/runs/37918010514) |
| Edge-function checks | Passed | [Testagram CI](https://github.com/Trendyzima/XClone-9b4dz1-9b4dz1-8936-20260809tr/actions/runs/37918010514) |
| Production build gate | Passed | [Production Build Gate](https://github.com/Trendyzima/XClone-9b4dz1-9b4dz1-8936-20260809tr/actions/runs/37918010280) |
| Frontend production quality gate | Passed | [Frontend Production Quality Gate](https://github.com/Trendyzima/XClone-9b4dz1-9b4dz1-8936-20260809tr/actions/runs/37918010395) |
| CDN integration gate | Passed | [CDN Integration Gate](https://github.com/Trendyzima/XClone-9b4dz1-9b4dz1-8936-20260809tr/actions/runs/37918010304) |
| TV hardware, sign-in and IPTV playback | **Not yet verified on physical TV hardware** | Requires device testing |
| Stable Android TV release signing | **Pending** | Configure and protect the long-lived signing identity before publishing a signed TV release |

For the live status of future commits, check [all GitHub Actions runs](https://github.com/Trendyzima/XClone-9b4dz1-9b4dz1-8936-20260809tr/actions). A green workflow only proves the checks that workflow actually ran; it does not guarantee that every production route, IPTV stream, payment integration, or device combination works.

Before calling a release production-ready, validate the signing certificate and upgrade path, fresh install, login/session persistence, Back navigation, video playback, IPTV playback, and target device compatibility. Android TV remote and playback checks require a real Android TV or Google TV device.
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
