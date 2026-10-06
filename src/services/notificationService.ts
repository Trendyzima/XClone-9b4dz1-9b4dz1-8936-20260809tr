import { supabase } from '../lib/supabase';
import type { NotificationEventInput, NotificationEventRecord } from '../types/notification';

/**
 * Native notification boundary. Realtime remains responsible for live UI state;
 * this service persists durable notification intent and lets the existing DB trigger
 * enqueue Novu delivery without exposing provider credentials to the browser.
 */
export async function emitNotification(input: NotificationEventInput): Promise<NotificationEventRecord> {
  const { data, error } = await supabase.rpc('create_domain_notification', {
    p_recipient_id: input.recipientId,
    p_kind: input.eventType,
    p_actor_id: input.actorId ?? null,
    p_post_id: input.entityType === 'post' ? input.entityId ?? null : null,
    p_type: input.eventType,
    p_data: {
      ...(input.payload ?? {}),
      ...(input.entityType ? { entity_type: input.entityType } : {}),
      ...(input.entityId ? { entity_id: input.entityId } : {}),
    },
    p_unique_key: input.uniqueKey ?? null,
  });
  if (error) throw new Error(`Notification enqueue failed: ${error.message}`);
  return data as NotificationEventRecord;
}

/** Reads use the canonical capability gateway; mutation remains a backend RPC boundary. */
export async function getMyNotifications(limit = 50) {
  const { backendCapabilities } = await import('@/services/backendClient');
  const safeLimit = Math.min(Math.max(limit, 1), 100);
  const result = await backendCapabilities.listNotifications(safeLimit);
  return result.items;
}

export const notificationService = { emitNotification, getMyNotifications };
export default notificationService;
