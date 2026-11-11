export const NOTIFICATION_SENDER = Symbol('NOTIFICATION_SENDER');
export interface NotificationRequest {
  readonly userId: string; readonly type: 'GRADE' | 'SYSTEM_ALERT' | 'SUBMISSION'; readonly title: string; readonly body: string;
  readonly link: Readonly<Record<string, string>>; readonly dedupeKey?: string;
}
/**
 * In-app notifications for other modules. Best effort by design: a lost notification never affects the change that
 * caused it (the grade itself is durable and audited).
 */
export interface NotificationSender { notify(requests: readonly NotificationRequest[]): Promise<void> }
