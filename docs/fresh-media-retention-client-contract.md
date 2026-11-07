# Fresh Testagram media lifecycle — client contract

The browser/mobile client never runs retention jobs and never deletes object-store keys. All lifecycle decisions and mutations are owned by Testagram Backend.

## Product behavior
- Normal posts remain permanent. Their text, comments, likes, reposts, bookmarks and post IDs remain available. Media attachments can become archived after 30 days; show a neutral archived/loading state while the backend restores media.
- Stories expire after 24 hours. The API is authoritative; clients hide stories whose server status is expired and must not extend expiry by editing or retrying.
- User-deleted media is hidden immediately and cannot receive new signed URLs. A restore action is shown only to the authenticated owner while the backend reports the 30-day recovery window as open.
- After the recovery deadline, the backend reports terminal deletion. The client must not imply recovery is possible.
- Never cache signed URLs beyond their TTL. On 403/404/410, refresh metadata from Backend; do not fall back to legacy Supabase URLs.

## API contract expected from Backend
- Story create response includes server-generated `created_at`, `expires_at`, and `status=active`.
- Story listing excludes expired items; a detail response may return `410 STORY_EXPIRED`.
- Media metadata includes `lifecycle_state` (`active|archive_pending|archived|delete_pending|deleted`), `availability`, and optionally `restore_state`.
- Owner deletion returns `deleted_at`, `recoverable_until`, and `status=delete_pending`.
- Owner restore is an authenticated idempotent POST; the server rechecks deadline and deletion lease transactionally.
- Archive restore is server-coalesced; clients request the media normally and receive pending/retryable state rather than creating provider copies themselves.

## Safety and UX
- Display the 30-day recovery deadline in the deletion confirmation.
- Do not offer permanent deletion as an immediate client-side action; the server owns final purge.
- Keep all user actions idempotent; retry with the same idempotency key.
- No retroactive expiry banner or cleanup sweep for pre-cutoff content.
- Existing Supabase-backed content remains untouched and is not a fallback source in fresh mode.

This contract does not enable retention. Feature flags and server-side policy must be approved before user-facing controls are exposed.
