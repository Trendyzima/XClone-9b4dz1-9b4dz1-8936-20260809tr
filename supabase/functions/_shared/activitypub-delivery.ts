export type DeliveryDisposition = "success" | "retry" | "dead_letter" | "gone" | "auth_failure" | "rate_limited";

export type DeliveryClassification = {
  disposition: DeliveryDisposition;
  retryable: boolean;
  permanent: boolean;
  reason: string;
  retryAfterSeconds: number | null;
};

export function classifyDeliveryResponse(status: number, retryAfterHeader?: string | null): DeliveryClassification {
  const retryAfterSeconds = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : null;
  if (status >= 200 && status < 300) return { disposition: "success", retryable: false, permanent: false, reason: "delivered", retryAfterSeconds: null };
  if (status === 401 || status === 403) return { disposition: "auth_failure", retryable: true, permanent: false, reason: "remote authentication or authorization failure", retryAfterSeconds };
  if (status === 404 || status === 410) return { disposition: "gone", retryable: false, permanent: true, reason: "remote inbox or resource is unavailable", retryAfterSeconds: null };
  if (status === 429) return { disposition: "rate_limited", retryable: true, permanent: false, reason: "remote rate limit", retryAfterSeconds };
  if (status >= 500 && status <= 599) return { disposition: "retry", retryable: true, permanent: false, reason: "remote server failure", retryAfterSeconds };
  if (status >= 400 && status <= 499) return { disposition: "dead_letter", retryable: false, permanent: true, reason: "permanent client rejection", retryAfterSeconds: null };
  return { disposition: "dead_letter", retryable: false, permanent: true, reason: "unexpected delivery response", retryAfterSeconds: null };
}

export function classifyDeliveryException(error: unknown): DeliveryClassification {
  const reason = error instanceof Error ? error.message : String(error);
  return { disposition: "retry", retryable: true, permanent: false, reason: reason.slice(0, 500), retryAfterSeconds: null };
}

export function boundedBackoffSeconds(attempt: number, retryAfterSeconds: number | null = null): number {
  if (retryAfterSeconds !== null && Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) return Math.min(retryAfterSeconds, 86400);
  const safeAttempt = Math.max(0, Math.min(attempt, 12));
  return Math.min(86400, 30 * (2 ** safeAttempt));
}
