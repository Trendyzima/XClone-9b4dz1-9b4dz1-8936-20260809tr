export const NOTIFICATION_EVENT_TYPES = [
  'message.created',
  'message.reply',
  'message.reaction',
  'message.mention',
  'call.incoming',
  'call.missed',
  'follow.created',
  'wallet.deposit.pending',
  'wallet.deposit.completed',
  'wallet.deposit.failed',
  'wallet.withdrawal.pending',
  'wallet.withdrawal.completed',
  'wallet.withdrawal.failed',
  'wallet.transfer.sent',
  'wallet.transfer.received',
  'wallet.payment.completed',
  'wallet.payment.failed',
  'wallet.earning.received',
  'wallet.reward.received',
  'wallet.security.blocked',
  'wallet.security.review',
  'wallet.savings.updated',
  'payout.pending',
  'payout.completed',
  'payout.failed',
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
