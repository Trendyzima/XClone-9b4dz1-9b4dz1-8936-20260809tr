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
    p_event_type: input.eventType,
    p_actor_id: input.actorId ?? null,
    p_entity_type: input.entityType ?? null,
    p_entity_id: input.entityId ?? null,
    p_payload: input.payload ?? {},
    p_unique_key: input.uniqueKey ?? null,
  });
  if (error) throw new Error(`Notification enqueue failed: ${error.message}`);
  return data as NotificationEventRecord;
}

export async function getMyNotifications(limit = 50) {
  const safeLimit = Math.min(Math.max(limit, 1), 100);
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(safeLimit);
  if (error) throw new Error(`Notification fetch failed: ${error.message}`);
  return data ?? [];
}

export const notificationService = { emitNotification, getMyNotifications };
export default notificationService;
