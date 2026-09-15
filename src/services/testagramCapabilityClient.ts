export type CapabilityError = {
  code: string;
  message: string;
};

export type CapabilityResponse<T> = {
  ok: boolean;
  data: T | null;
  error: CapabilityError | null;
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
  timeoutMs?: number;
};

export class CapabilityClientError extends Error {
  readonly code: string;
  readonly requestId: string | null;
  readonly status: number | null;

  constructor(
    message: string,
    options: { code?: string; requestId?: string | null; status?: number | null } = {},
  ) {
    super(message);
    this.name = "CapabilityClientError";
    this.code = options.code ?? "CAPABILITY_REQUEST_FAILED";
    this.requestId = options.requestId ?? null;
    this.status = options.status ?? null;
  }
}

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_TIMEOUT_MS = 30_000;
const MAX_LIMIT = 100;

function boundedLimit(limit: number): number {
  if (!Number.isFinite(limit)) return 20;
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(limit)));
}

function optionalCursor(cursor?: string): Record<string, string> {
  return cursor ? { cursor } : {};
}

function requestId(): string {
  return typeof crypto?.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Native Testagram capability client.
 *
 * xurl-inspired principles adapted to Testagram:
 * - friendly shortcuts over a constrained capability surface;
 * - explicit capability calls for advanced clients;
 * - request IDs and client metadata for tracing;
 * - caller-owned auth tokens that are never persisted or logged here;
 * - bounded pagination and deterministic timeout behavior;
 * - structured errors retaining the server error code and request ID;
 * - no arbitrary RPC/table/function execution.
 */
export class TestagramCapabilityClient {
  private readonly endpoint: string;
  private readonly getAccessToken: () => Promise<string | null>;
  private readonly clientName: string;
  private readonly clientVersion: string;
  private readonly timeoutMs: number;

  constructor(options: TestagramCapabilityClientOptions) {
    if (!options.endpoint?.trim()) throw new Error("Capability endpoint is required");

    this.endpoint = options.endpoint.replace(/\/$/, "");
    this.getAccessToken = options.getAccessToken;
    this.clientName = options.clientName ?? "testagram-client";
    this.clientVersion = options.clientVersion ?? "1";
    this.timeoutMs = Math.min(
      MAX_TIMEOUT_MS,
      Math.max(1_000, Math.floor(options.timeoutMs ?? DEFAULT_TIMEOUT_MS)),
    );
  }

  async call<T>(capability: string, input: Record<string, unknown> = {}): Promise<T> {
    if (!capability.trim()) {
      throw new CapabilityClientError("Capability name is required", { code: "CAPABILITY_REQUIRED" });
    }

    const token = await this.getAccessToken();
    if (!token) {
      throw new CapabilityClientError("Authentication required", { code: "AUTH_REQUIRED" });
    }

    const id = requestId();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Request-Id": id,
          "X-Testagram-Client": this.clientName,
          "X-Testagram-Client-Version": this.clientVersion,
        },
        body: JSON.stringify({ capability, input }),
        signal: controller.signal,
      });

      let payload: CapabilityResponse<T> | null = null;
      try {
        payload = (await response.json()) as CapabilityResponse<T>;
      } catch {
        throw new CapabilityClientError("Gateway returned invalid JSON", {
          code: "INVALID_GATEWAY_RESPONSE",
          requestId: response.headers.get("x-request-id") ?? id,
          status: response.status,
        });
      }

      const responseRequestId = payload.request_id || response.headers.get("x-request-id") || id;
      if (!response.ok || !payload.ok) {
        throw new CapabilityClientError(
          payload.error?.message ?? `Capability request failed (${response.status})`,
          {
            code: payload.error?.code ?? "CAPABILITY_REQUEST_FAILED",
            requestId: responseRequestId,
            status: response.status,
          },
        );
      }

      return payload.data as T;
    } catch (error) {
      if (error instanceof CapabilityClientError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new CapabilityClientError("Capability request timed out", {
          code: "TIMEOUT",
          requestId: id,
        });
      }
      throw new CapabilityClientError(
        error instanceof Error ? error.message : "Capability request failed",
        { code: "NETWORK_ERROR", requestId: id },
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  listCapabilities() {
    return this.call<{ capabilities: unknown[] }>("testagram.capabilities.list");
  }

  searchPosts(q: string, limit = 20, cursor?: string) {
    return this.call<CapabilityPage<unknown>>("testagram.search.posts", {
      q,
      limit: boundedLimit(limit),
      ...optionalCursor(cursor),
    });
  }

  searchUsers(q: string, limit = 20, cursor?: string) {
    return this.call<CapabilityPage<unknown>>("testagram.search.users", {
      q,
      limit: boundedLimit(limit),
      ...optionalCursor(cursor),
    });
  }

  createPost(body: string, options: { communityId?: string } = {}) {
    return this.call<{ post: unknown }>("testagram.posts.create", {
      body,
      ...(options.communityId ? { community_id: options.communityId } : {}),
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
    return this.call<CapabilityPage<unknown>>("testagram.lists.timeline", {
      list_id: listId,
      limit: boundedLimit(limit),
      ...optionalCursor(cursor),
    });
  }

  getTrends(limit = 20) {
    return this.call<{ items: unknown[] }>("testagram.trends.list", { limit: boundedLimit(limit) });
  }

  getWallet(limit = 20, cursor?: string) {
    return this.call<{ wallet: unknown; transactions: unknown[]; next_cursor?: string | null }>(
      "testagram.wallet.read",
      { limit: boundedLimit(limit), ...optionalCursor(cursor) },
    );
  }
}
