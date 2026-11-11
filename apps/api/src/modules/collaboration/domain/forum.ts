export class CollaborationError extends Error {
  constructor(readonly code: 'INVALID_INPUT' | 'FORBIDDEN' | 'NOT_FOUND' | 'LOCKED') { super(code); }
}
export type Role = 'ADMIN' | 'TEACHER' | 'INSTRUCTIONAL_DESIGNER' | 'STUDENT';
export interface Actor { readonly id: string; readonly role: Role }
export interface CourseContext { readonly courseId: string; readonly teacherId: string; readonly published: boolean; readonly enrolled: boolean }
export type Access = 'MODERATE' | 'PARTICIPATE' | 'READ';

export function text(value: unknown, max: number, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim()) || value.trim().length > max) throw new CollaborationError('INVALID_INPUT');
  return value.trim();
}
/** Course forums: teacher and admin moderate, enrolled students of a published course participate, designers read (CU-05/09). */
export function accessOf(actor: Actor, course: CourseContext): Access {
  if (actor.role === 'ADMIN' || (actor.role === 'TEACHER' && actor.id === course.teacherId)) return 'MODERATE';
  if (actor.role === 'STUDENT' && course.published && course.enrolled) return 'PARTICIPATE';
  if (actor.role === 'INSTRUCTIONAL_DESIGNER') return 'READ';
  throw new CollaborationError('FORBIDDEN');
}
export function requireAccess(access: Access, needed: Access): void {
  const rank = { READ: 0, PARTICIPATE: 1, MODERATE: 2 };
  if (rank[access] < rank[needed]) throw new CollaborationError('FORBIDDEN');
}

// ---------------- Observer (fig. 5): a thread notifies its subscribers without knowing how they deliver ----------------
export interface MessagePosted {
  readonly courseId: string; readonly forumId: string; readonly threadId: string; readonly threadTitle: string; readonly messageId: string;
  readonly authorId: string; readonly excerpt: string; readonly newThread: boolean; readonly postedAt: string;
}
export interface NotificationDraft {
  readonly userId: string; readonly type: 'FORUM_REPLY' | 'FORUM_NEW_THREAD' | 'DUE_SOON' | 'GRADE' | 'SYSTEM_ALERT' | 'SUBMISSION'; readonly title: string; readonly body: string;
  readonly link: Record<string, string>; readonly dedupeKey?: string;
}
export interface ThreadSubscriber { update(event: MessagePosted): NotificationDraft[] }

/** NotificadorDocente: the responsible teacher hears about every new thread and reply in the course forums. */
export class TeacherNotifier implements ThreadSubscriber {
  constructor(private readonly teacherId: string) {}
  update(event: MessagePosted): NotificationDraft[] {
    if (event.authorId === this.teacherId) return [];
    return [{ userId: this.teacherId, type: event.newThread ? 'FORUM_NEW_THREAD' : 'FORUM_REPLY',
      title: event.newThread ? `Nuevo hilo: ${event.threadTitle}` : `Nueva respuesta en «${event.threadTitle}»`, body: event.excerpt,
      link: { courseId: event.courseId, forumId: event.forumId, threadId: event.threadId }, dedupeKey: `${event.messageId}:${this.teacherId}` }];
  }
}
/** NotificadorEstudiante: subscribed participants (except the author and the teacher, notified above) hear about replies. */
export class SubscriberNotifier implements ThreadSubscriber {
  constructor(private readonly subscriberIds: readonly string[], private readonly teacherId: string) {}
  update(event: MessagePosted): NotificationDraft[] {
    if (event.newThread) return [];
    return [...new Set(this.subscriberIds)].filter(id => id !== event.authorId && id !== this.teacherId).map(userId => ({
      userId, type: 'FORUM_REPLY' as const, title: `Nueva respuesta en «${event.threadTitle}»`, body: event.excerpt,
      link: { courseId: event.courseId, forumId: event.forumId, threadId: event.threadId }, dedupeKey: `${event.messageId}:${userId}` }));
  }
}

export interface ThreadData {
  readonly id: string; readonly forumId: string; readonly courseId: string; readonly authorId: string; readonly title: string;
  readonly pinned: boolean; readonly locked: boolean; readonly createdAt: string; readonly lastActivityAt: string;
}
/** HiloDiscusion: publishing a message validates the thread state and notifies every attached observer. */
export class DiscussionThread {
  private readonly observers: ThreadSubscriber[] = [];
  constructor(readonly data: ThreadData) {}
  subscribe(observer: ThreadSubscriber): this { this.observers.push(observer); return this; }
  publish(input: { messageId: string; authorId: string; body: string; postedAt: string; newThread?: boolean }, access: Access): { body: string; event: MessagePosted; notifications: NotificationDraft[] } {
    requireAccess(access, 'PARTICIPATE');
    if (this.data.locked && access !== 'MODERATE') throw new CollaborationError('LOCKED');
    const body = text(input.body, 10000);
    const event: MessagePosted = { courseId: this.data.courseId, forumId: this.data.forumId, threadId: this.data.id, threadTitle: this.data.title,
      messageId: input.messageId, authorId: input.authorId, excerpt: body.length > 180 ? `${body.slice(0, 177)}…` : body, newThread: !!input.newThread, postedAt: input.postedAt };
    return { body, event, notifications: this.observers.flatMap(observer => observer.update(event)) };
  }
}
