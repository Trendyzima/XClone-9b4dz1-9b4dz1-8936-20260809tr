/** Access policy for Mastodon-compatible status reads. Fail closed for unknown visibility values. */
export function canViewMastodonStatus(
  visibilityValue: unknown,
  authorId: string,
  viewerId: string | null,
  followsAuthor: boolean,
): boolean {
  // Missing/corrupt visibility metadata must never silently downgrade a post to public.
  const visibility = typeof visibilityValue === "string"
    ? visibilityValue.toLowerCase().trim()
    : "";
  if (visibility === "public" || visibility === "unlisted") return true;
  if (!viewerId) return false;
  if (viewerId === authorId) return true;
  return visibility === "followers" && followsAuthor;
}

export function normalizeMastodonVisibility(value: unknown): "public" | "unlisted" | "private" | "direct" {
  switch (typeof value === "string" ? value.toLowerCase().trim() : "") {
    case "unlisted": return "unlisted";
    case "followers":
    case "private": return "private";
    case "direct": return "direct";
    case "public": return "public";
    default: return "direct";
  }
}
