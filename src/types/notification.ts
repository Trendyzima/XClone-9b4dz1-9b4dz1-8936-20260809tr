export const NOTIFICATION_EVENT_TYPES = [
  'message.created',
  'message.reply',
  'message.reaction',
  'message.mention',
  'call.incoming',
  'call.missed',
  'follow.created',
  'wallet.deposit.completed',
  'wallet.deposit.failed',
] as const;

export type NotificationEventType = (typeof NOTIFICATION_EVENT_TYPES)[number];

export interface NotificationEventInput {
  recipientId: string;
  eventType: NotificationEventType;
  actorId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  payload?: Record<string, unknown>;
  uniqueKey?: string;
}

export interface NotificationEventRecord extends NotificationEventInput {
  id: string;
  status: 'pending' | 'queued' | 'sent' | 'failed' | 'skipped';
  createdAt: string;
}
