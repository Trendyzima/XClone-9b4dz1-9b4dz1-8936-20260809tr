# Testagram Notifications + Novu

Testagram remains the source of truth for notification state. Novu is a server-side delivery/orchestration adapter only.

## Runtime contract

```text
Native Testagram events
        |
        v
public.notifications  <-- authoritative, RLS protected
        |
        +--> Capability Gateway --> Notifications UI
        |
        +--> notification_delivery_outbox
                    |
                    v
          novu-notification-delivery
                    |
                    v
          Novu POST /v1/events/trigger
                    |
                    +--> push / email / SMS / chat
```

The browser never receives `NOVU_API_KEY` and never calls Novu directly.

## Canonical capabilities

- `testagram.notifications.list`
- `testagram.notifications.unread_count`
- `testagram.notifications.mark_read`
- `testagram.notifications.mark_all_read`
- `testagram.notifications.preferences`
- `testagram.notifications.preference_upsert`
- `testagram.notifications.dismiss`
- `testagram.notifications.subscribe`

The realtime transport is Supabase Realtime on `public.notifications`, scoped to the authenticated recipient. The database remains authoritative for read/archive state.

## Novu configuration

Configure these Supabase Edge Function secrets before enabling delivery:

- `NOVU_API_KEY`
- `NOVU_NOTIFICATION_WORKFLOW_ID`
- optional `NOVU_API_URL` (defaults to `https://api.novu.co`)

`NOVU_NOTIFICATION_WORKFLOW_ID` is the Novu workflow trigger identifier used for Testagram notifications.

The delivery worker uses the notification UUID as the `Idempotency-Key`, so retrying the same outbox row does not intentionally create duplicate Novu workflow runs when Novu idempotency is enabled for the organization.

## Reference

Novu's current server API documents `POST /v1/events/trigger` for triggering a workflow and supports a workflow identifier, subscriber target and payload. The Testagram adapter follows that contract while keeping the provider credential server-side.
