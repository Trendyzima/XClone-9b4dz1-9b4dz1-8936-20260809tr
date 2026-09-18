import type { NotificationEventInput, NotificationEventRecord } from '../types/notification';
import { backendCapabilities } from '@/services/backendClient';

/** Canonical notification boundary. Browser code uses the capability gateway. */
export async function emitNotification(input: NotificationEventInput): Promise<NotificationEventRecord> {
  throw new Error('Direct notification emission is intentionally disabled; domain notifications must be emitted by backend triggers or capability-specific commands.');
}

export async function getMyNotifications(limit = 50) {
  const safeLimit = Math.min(Math.max(limit, 1), 100);
  const result = await backendCapabilities.listNotifications(safeLimit);
  return result.items;
}

export const notificationService = { emitNotification, getMyNotifications };
export default notificationService;
