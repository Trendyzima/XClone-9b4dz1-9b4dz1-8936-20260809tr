import { backendCapabilities } from '@/services/testagramCapabilityClient';
import type { NotificationEventInput, NotificationEventRecord } from '../types/notification';

/**
 * Native notification boundary. Realtime remains responsible for live UI state;
 * this service persists durable notification intent and lets the existing DB trigger
 * enqueue Novu delivery without exposing provider credentials to the browser.
 */
export async function emitNotification(input: NotificationEventInput): Promise<NotificationEventRecord> {
  return backendCapabilities.call<NotificationEventRecord>('testagram.notifications.emit', {
    recipient_id: input.recipientId,
    event_type: input.eventType,
    actor_id: input.actorId ?? null,
    entity_type: input.entityType ?? null,
    entity_id: input.entityId ?? null,
    payload: input.payload ?? {},
    unique_key: input.uniqueKey ?? null,
  });
}
/** Reads use the canonical capability gateway; mutation remains a backend RPC boundary. */
export async function getMyNotifications(limit = 50) {
  
  const safeLimit = Math.min(Math.max(limit, 1), 100);
  const result = await backendCapabilities.listNotifications(safeLimit);
  return result.items;
}

export const notificationService = { emitNotification, getMyNotifications };
export default notificationService;
