# Testagram backend migration (non-destructive)

This is the portability runbook for moving Testagram to another compatible Supabase backend without changing the logical identity of the platform.

## What must survive
- Every UUID primary/foreign key exactly as-is.
- `auth.users` IDs and authentication records.
- `profiles` and all local application records.
- Posts, replies, reposts, quotes, likes/reactions and bookmarks.
- Communities, follows, notifications, messaging, TV records, wallet records and governance records.
- `media_assets.bucket` + `media_assets.storage_key` and every media relationship.
- Fediverse actor/object/activity URIs and all federation state needed to continue processing.
- ActivityPub keys and actor records.
- Realtime/publication configuration, Edge Functions and other project configuration.
- Storage bytes separately from the database.

## Migration safety rules
1. **Never delete the source during export.**
2. **Never rewrite UUIDs.** A migrated row keeps the same ID.
3. **Never rewrite ActivityPub URIs.** They are external identity.
4. **Never copy absolute Supabase media URLs as the source of truth.** `media_assets.bucket` + `storage_key` is the portable reference.
5. **Export first, import second, verify third, cut over last.**
6. Keep source and target running in parallel until verification passes.
7. Take a final delta/export immediately before cutover.
8. Only after the target is verified should DNS/API configuration be switched.
9. Keep the source read-only during the final cutover window; do not destroy it.
10. For a true Supabase-to-Supabase clone, prefer Supabase's **Restore to a new project** flow when available because it can carry database/auth data and the encryption root key. Storage objects, Edge Functions, Auth settings/API keys and Realtime configuration still require separate handling.

## Portability layers
### Database
Use a full logical/physical migration appropriate to the target. The repository portability manifest records all public table row counts, auth user count, storage inventory, FK count, RLS count and a stable logical backend ID.

### Authentication
For logical migration, preserve complete `auth` data and user UUIDs. Existing sessions/tokens depend on the JWT secret; a new project with a different JWT secret invalidates old tokens.

### Storage/media
Database backups do not contain Storage object bytes. Export every bucket's bytes and restore them with the same bucket names and object paths. Keep `media_assets.storage_key` unchanged.

### Federation
Preserve `federated_actors`, `federated_objects`, `federated_activities`, `federated_replies`, `federated_quotes`, `federated_reactions`, `federated_bookmarks`, `federated_relationships`, `federated_follow_relationships`, `federation_deliveries`, `activitypub_actors` and `activitypub_keys`. External URIs are identity, not cache-only values.

### Application/runtime
Deploy the same repository commit to the new backend and configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. The client now reads these variables and falls back to the current production backend, so existing deployments remain compatible.

## Preflight
Run:

```sql
select public.backend_portability_manifest();
```

Save the returned manifest with the migration artifact.

## Verification gate
The target must have matching public table list/counts, FK count, RLS count, auth user count, storage inventory, media counts and federation counts. Also verify `profile -> post -> reply`, `profile -> post -> quoted_post`, `profile -> post -> repost`, `profile -> post -> reaction/bookmark`, `federated_actor -> federated_object -> federated_activity`, and `media_asset -> post_media -> post`.

## Cutover
1. Freeze writes briefly or enter read-only mode.
2. Run final delta export.
3. Import the delta.
4. Re-run the complete verification gate.
5. Point application/backend environment variables to the target.
6. Smoke-test login, posting, replies, quotes, reposts, reactions, bookmarks, media playback and federation.
7. Keep the source intact for rollback.
8. Roll back by switching the backend endpoint back; never by deleting/recreating source data.

## Important Supabase distinction
A database dump is not a complete project backup. Storage bytes, Edge Functions, Auth settings/API keys, Realtime configuration and some managed configuration need separate migration steps. Use the repository scripts as an operator checklist, not as permission to destroy the source.