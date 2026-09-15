# Testagram Capability Samples

This is the Testagram-native adaptation of the useful ideas in `xdevplatform/samples`.

The upstream samples demonstrate discoverable, copyable workflows across posts, users, timelines, lists, bookmarks, media and other API areas. Testagram keeps that workflow orientation but routes every operation through the native capability contract. The upstream project is an X API sample collection and therefore its credentials and endpoints are deliberately **not** reused here.

## Capability workflow categories

| Category | Native Testagram capability examples |
|---|---|
| Discovery | `testagram.search.posts`, `testagram.search.users`, `testagram.trends.list` |
| Posts | `testagram.posts.list`, `testagram.posts.create`, `testagram.posts.like`, `testagram.posts.repost` |
| Social graph | `testagram.follows.set`, `testagram.follows.state` |
| Lists | `testagram.lists.list`, `testagram.lists.create`, `testagram.lists.timeline` |
| Bookmarks | `testagram.bookmarks.list`, `testagram.bookmarks.add`, `testagram.bookmarks.remove` |
| Media | `testagram.media.list`, `testagram.media.attach` |
| Communities | `testagram.communities.list`, `testagram.communities.create`, `testagram.communities.join`, `testagram.communities.leave` |
| Recommendations | `testagram.recommendations.generate` |
| Notifications | `testagram.notifications.rank` |
| Federation | `testagram.federation.outbox.status` |
| Wallet | `testagram.wallet.read`, `testagram.wallet.transactions` |

## Security contract

Samples must use `TestagramCapabilityClient`. They must not contain service-role keys, wallet secrets, federation signing keys, arbitrary RPC names or direct SQL. Authentication is supplied by the application's existing Supabase session.

## Example

```ts
const results = await client.searchPosts("football", 20);
await client.likePost(results.items[0].id);
await client.repostPost(results.items[0].id);
```

The capability gateway remains the authorization boundary and preserves the request ID, error envelope, pagination and telemetry contract.
