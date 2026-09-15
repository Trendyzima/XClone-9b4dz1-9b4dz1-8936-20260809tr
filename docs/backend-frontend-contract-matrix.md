# Testagram backend ↔ frontend contract matrix

This document is the surgical wiring map for the current Trendyzima/XClone project. It is additive: existing tables, functions, pages and contracts remain authoritative until a verified migration replaces them.

## Contract rules

1. **Frontend never receives provider secrets.** M-Pesa, PayPal, Pesapal, R2 and service-role credentials stay in Edge Function secrets.
2. **User-bound calls carry the Supabase access token.** The backend must resolve `auth.uid()`/`auth.getUser()` and must not trust a frontend-supplied `user_id` for ownership.
3. **Money movement is function-owned.** Wallet balance changes happen only after provider acceptance/callback/reconciliation, never from a browser table update.
4. **Social primitives are native Supabase first.** Posts, follows, likes, reposts, bookmarks, lists, communities and media should use the native capability plane or dedicated Edge Functions rather than gateway relay compatibility paths.
5. **Federation is isolated.** ActivityPub/Mastodon transport tables and workers are not mixed with local social tables; UI adapters consume normalized results.
6. **No destructive migration.** New columns, RPCs, adapters or compatibility views must be additive and verified before any old path is retired.

## Feature-to-backend matrix

| Frontend surface / feature | Primary backend tables | Backend contract | Auth | Wiring target | Status |
|---|---|---|---|---|---|
| Authentication / sessions | `auth.users`, `profiles`, `user_devices`, `user_settings` | Supabase Auth + session | User session | `src/lib/supabase.ts`, `AuthProvider` | Native |
| Home / For You feed | `posts`, `post_media`, `profiles`, `follows`, recommendation tables | `testagram.posts.list`, `feed-fast`, recommendation RPCs | Auth | Capability client | Native capability + feed function |
| Create post | `posts`, `post_media`, `media_assets`, hashtags/mentions | `testagram.posts.create`, `post-create` | Auth | ComposePost → native contract | Native capability |
| Likes | `post_likes` | `testagram.posts.like` / native RPC | Auth | PostCard → capability client | Native capability |
| Reposts | `post_reposts` | `testagram.posts.repost` / native RPC | Auth | PostCard → capability client | Native capability |
| Follows | `follows`, `follow_requests` | `testagram.follows.set`, `testagram.follows.state` | Auth | FollowButton/useFollow → capability client | Native capability |
| Bookmarks | `bookmarks`, `bookmark_folders`, `bookmark_folder_items` | bookmark capabilities | Auth | BookmarksPage/BookmarkButton → capability client | Native capability |
| Lists | `lists`, `list_members`, `list_followers` | list capabilities | Auth | ListsPage/ListDetailPage → capability client | Native capability |
| Search | `profiles`, `posts`, hashtags, communities | `testagram.search.*`, `search-everything` | Auth | SearchPage* → search adapter | Native capability + search function |
| Trends / hashtags | `trending_topics`, `trending_hashtags`, `hashtags`, `post_hashtags` | `testagram.trends.list` + native reads | Auth | Trending/Hashtag pages | Native capability |
| Notifications | `notifications`, `notification_preferences` | `testagram.notifications.rank` + native realtime | Auth | NotificationsPage | Native capability |
| Media upload | `media_assets`, `post_media` | `media-upload`, `testagram.media.attach` | Auth | media helper → upload → attach | Dedicated function + capability |
| Wallet read/history | `wallets`, `wallet_transactions`, `user_wallets`, `wallet_accounts` | `testagram.wallet.read` | Auth | `useWallet`/WalletPage | Native capability; identity bridge required |
| M-Pesa top-up | `wallets`, `wallet_transactions`, `mpesa_payments` | `mpesa-stk-push` → callback/status | Auth for initiation; provider callback unauthenticated | Wallet → exact STK contract | Dedicated payment function |
| M-Pesa withdrawal | `wallets`, `wallet_transactions`, `payout_requests` | `mpesa-b2c-payout` → `mpesa-b2c-result` | Auth initiation; provider callback | Payouts/Wallet | Dedicated payment functions |
| PayPal top-up | `wallets`, `wallet_transactions`, `paypal_orders`, `paypal_webhook_events` | `paypal-create-order` → `paypal-capture-order` → webhook | Auth initiation; webhook provider | Wallet/PayPalTopUp | Dedicated payment functions |
| PesaPal top-up | `wallets`, `wallet_transactions`, `pesapal_payment_orders` | `pesapal-create-order` → IPN/sync | Auth initiation; IPN provider | Wallet/PesaPalTopUp | Dedicated payment functions |
| P2P wallet transfer | `wallets`, `wallet_transactions`, `transactions` | secure P2P transfer RPC/migration contract | Auth | Wallet send/request | Backend RPC; audit contract |
| Creator earnings | `creator_earnings`, `creator_programs`, `creator_quality_signals`, `revenue_shares` | monetization RPCs/functions | Auth | CreatorStudio/Monetization | Native DB + scheduled functions |
| Creator payouts | `creator_payouts`, `payout_requests`, `monetization_payouts` | payout functions | Auth | PayoutsPage | Dedicated payout plane |
| Premium/subscriptions | `subscriptions`, `creator_subscriptions` | payment order/capture + subscription records | Auth | PremiumPage | Payment + native DB |
| Ads | `ad_placements`, `ad_sponsorships`, `ad_events`, analytics tables | native CRUD + analytics functions | Auth/admin depending operation | Ads pages/widgets | Native DB; admin authorization audit |
| Communities | `communities`, `community_members`, `community_memberships`, `community_posts` | community capabilities | Auth | CommunitiesPage/CommunityPage | Native capability |
| Polls | `polls`, `poll_options`, `poll_votes` | native table/RPC contract | Auth | CreatePollDialog/PollCard | Audit exact frontend calls |
| Threads | `threads`, `thread_replies`, `thread_likes`, `thread_reposts`, `thread_bookmarks` | native DB/RPC contract | Auth | Threads/ThreadDetail/CreateThread | Audit exact frontend calls |
| Direct messages | `conversations`, `conversation_members`, `messages`, attachments/reactions/pins | native Realtime + RLS | Auth | MessagesPage | Native DB/Realtime |
| Audio Spaces | `audio_spaces`, `space_members`, `space_participants`, recordings/reminders | native Realtime/RPC contract | Auth | Spaces/SpaceDetail/Live pages | Audit exact frontend calls |
| Live streams | `live_streams`, `stream_chat`, `stream_viewers` | native stream contract | Auth | LiveStream/StartStream | Audit exact frontend calls |
| Stories | story-related content/events and media tables | native DB/media contract | Auth | StoriesStrip/Story pages | Audit exact frontend calls |
| Videos / reels | `reels`, `reel_events`, `reel_sounds`, `media_assets` | native media/reel contract | Auth | Videos/FastPix/VideoPlayer | Audit exact frontend calls |
| Marketplace/products | `products`, `post_products`, orders/wishlist tables | native commerce contract + payment functions | Auth | Products/Marketplace/Seller/Orders/Wishlist | Audit exact frontend calls |
| Recommendations | `content_recommendations`, `recommendation_feedback`, ranking tables | `generate_content_recommendations` | Auth | Home/Discover/Explore | Native RPC |
| AI | `ai_usage`, knowledge tables | AI Edge Functions | Auth | AIPage/AIBot/Help | Dedicated AI functions |
| Moderation | `content_reports`, `moderation_actions`, reports | `ai-moderation` + admin RPCs | Auth/admin | report/moderation UI | Dedicated moderation plane |
| Verification | `verification_requests`, `platform_admins` | native admin RPCs | Auth/admin | Verification pages | Admin authorization audit |
| Federation status/feed | federation/fediverse tables | `federated-feed`, federation workers, Mastodon compatibility functions | Auth for local UI; public transport endpoints where required | FediversePage/hooks | Dedicated federation plane |
| Federation interactions | `federated_interactions`, relationship tables | `federation-interact`, ActivityPub/Mastodon functions | Auth/local; signed transport remotely | Fediverse UI | Dedicated federation plane |
| Federation transport | inbox/outbox/delivery/worker tables | inbox/outbox/delivery workers | Provider/worker | Not browser-direct | Worker plane |
| Notifications/realtime | `notifications`, `push_subscriptions`, preferences | Supabase Realtime + notification functions | Auth | Notification hooks/pages | Native Realtime |
| Media storage | `media_assets` | `media-upload` / `r2-media` | Auth | media.ts/components | Dedicated media plane |
| SEO/sitemaps | sitemap/metadata sources | sitemap/OG functions | Public where appropriate | SEO hooks/pages | Dedicated public functions |
| Service health/telemetry | `service_metrics`, health views | `service-health`, capability health | Public/read-only where appropriate | admin/ops | Operational plane |

## Capability-plane contract currently defined

The repository's canonical capability catalog contains 31 explicitly allowlisted capabilities. The database `capability_registry` also contains those 31 enabled records. The deployed `capability-gateway` must stay synchronized with that registry; it must never silently fall back to dynamic routing.

| Capability group | Contracts |
|---|---|
| Core | `capabilities.list`, `health.read` |
| Posts | `posts.list`, `posts.create`, `posts.like`, `posts.repost` |
| Discovery | `search.posts`, `search.users`, `recommendations.generate`, `trends.list`, `notifications.rank` |
| Follows | `follows.set`, `follows.state` |
| Lists | `lists.list`, `lists.create`, `lists.member.add`, `lists.member.remove`, `lists.timeline` |
| Bookmarks | `bookmarks.list`, `bookmarks.add`, `bookmarks.remove`, `bookmarks.folders.list`, `bookmarks.folders.create` |
| Media | `media.list`, `media.attach` |
| Communities | `communities.list`, `communities.create`, `communities.join`, `communities.leave` |
| Account | `federation.status`, `wallet.read` |

## Payment contracts

| Operation | Frontend payload | Edge Function | Backend ownership |
|---|---|---|---|
| M-Pesa deposit | `{amount_kes, phone, metadata:{wallet_id}}` | `mpesa-stk-push` | STK request + pending ledger; callback finalizes |
| M-Pesa status | `{checkout_request_id}` | `mpesa-stk-status` | Provider status/reconciliation |
| M-Pesa withdrawal | payout amount + phone/wallet context | `mpesa-b2c-payout` | debit reservation + B2C request |
| M-Pesa payout result | provider callback | `mpesa-b2c-result` | finalize payout |
| PayPal order | wallet + amount/currency | `paypal-create-order` | order creation |
| PayPal capture | provider order id | `paypal-capture-order` | capture + settlement |
| PayPal webhook | provider event | `paypal-webhook` | authoritative settlement reconciliation |
| PesaPal order | wallet + amount | `pesapal-create-order` | order creation |
| PesaPal IPN | provider event | `pesapal-ipn` | authoritative settlement |
| PesaPal sync | order/tracking id | `pesapal-sync-order` | reconciliation |

## Surgical implementation order

1. Keep `wallets` as the payment identity and `user_wallets` as the legacy/UI compatibility record until all callers are migrated.
2. Synchronize the deployed capability gateway with the repository's 31-capability contract before routing additional frontend features through it.
3. Route social primitives (posts/follows/likes/reposts/bookmarks/lists/communities/media) through the canonical capability client.
4. Keep payment initiation and callbacks on dedicated payment functions; never route provider credentials through the generic gateway.
5. Route federation through federation-specific functions/workers and expose only normalized UI contracts.
6. Audit remaining pages feature-by-feature against the matrix and replace legacy gateway relay calls with the native contract where an equivalent capability exists.
7. Verify each write with a database readback and each function with an authenticated integration test before retiring an old path.

## Definition of done

A feature is considered wired only when all four are true:

- the frontend has a typed request/response contract;
- the backend function/RPC/table ownership is explicit;
- authentication/RLS/authorization is verified;
- a read/write integration check confirms the same operation from UI to persisted state.
