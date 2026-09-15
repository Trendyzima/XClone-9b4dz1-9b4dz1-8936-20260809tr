export type CapabilityResponse<T> = {
  ok: boolean;
  data: T | null;
  error: { code: string; message: string } | null;
  request_id: string;
};

export type CapabilityPage<T> = {
  items: T[];
  next_cursor: string | null;
};

export type TestagramCapabilityClientOptions = {
  endpoint: string;
  getAccessToken: () => Promise<string | null>;
  clientName?: string;
  clientVersion?: string;
};

/**
 * Native Testagram capability client.
 *
 * xurl-inspired principles adapted to Testagram:
 * - shortcut methods for common operations;
 * - a raw, explicit capability call for advanced clients;
 * - request IDs for tracing;
 * - caller-owned auth tokens (never persisted or logged here);
 * - no arbitrary RPC/table/function execution.
 */
export class TestagramCapabilityClient {
  private readonly endpoint: string;
  private readonly getAccessToken: () => Promise<string | null>;
  private readonly clientName: string;
  private readonly clientVersion: string;

  constructor(options: TestagramCapabilityClientOptions) {
    this.endpoint = options.endpoint.replace(/\/$/, "");
    this.getAccessToken = options.getAccessToken;
    this.clientName = options.clientName ?? "testagram-client";
    this.clientVersion = options.clientVersion ?? "1";
  }

  async call<T>(capability: string, input: Record<string, unknown> = {}): Promise<T> {
    const token = await this.getAccessToken();
    if (!token) throw new Error("Authentication required");

    const requestId = crypto.randomUUID();
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Request-Id": requestId,
        "X-Testagram-Client": this.clientName,
        "X-Testagram-Client-Version": this.clientVersion,
      },
      body: JSON.stringify({ capability, input }),
    });

    const payload = (await response.json()) as CapabilityResponse<T>;
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error?.message ?? `Capability request failed (${response.status})`);
    }
    return payload.data as T;
  }

  listCapabilities() {
    return this.call<{ capabilities: unknown[] }>("testagram.capabilities.list");
  }

  searchPosts(q: string, limit = 20, cursor?: string) {
    return this.call<CapabilityPage<unknown>>("testagram.search.posts", { q, limit, cursor });
  }

  searchUsers(q: string, limit = 20, cursor?: string) {
    return this.call<CapabilityPage<unknown>>("testagram.search.users", { q, limit, cursor });
  }

  createPost(body: string, options: { communityId?: string } = {}) {
    return this.call<{ post: unknown }>("testagram.posts.create", {
      body,
      community_id: options.communityId,
    });
  }

  likePost(postId: string) {
    return this.call<{ state: unknown }>("testagram.posts.like", { post_id: postId });
  }

  repostPost(postId: string) {
    return this.call<{ state: unknown }>("testagram.posts.repost", { post_id: postId });
  }

  bookmarkPost(postId: string) {
    return this.call<{ bookmark: unknown }>("testagram.bookmarks.add", { post_id: postId });
  }

  removeBookmark(postId: string) {
    return this.call<{ removed: boolean }>("testagram.bookmarks.remove", { post_id: postId });
  }

  followUser(userId: string, follow = true) {
    return this.call<{ state: unknown }>("testagram.follows.set", { user_id: userId, follow });
  }

  getFollowState(userId: string) {
    return this.call<{ state: unknown }>("testagram.follows.state", { user_id: userId });
  }

  getListTimeline(listId: string, limit = 20, cursor?: string) {
    return this.call<CapabilityPage<unknown>>("testagram.lists.timeline", { list_id: listId, limit, cursor });
  }

  getTrends(limit = 20) {
    return this.call<{ items: unknown[] }>("testagram.trends.list", { limit });
  }

  getWallet() {
    return this.call<{ wallet: unknown; transactions: unknown[] }>("testagram.wallet.read");
  }
}
