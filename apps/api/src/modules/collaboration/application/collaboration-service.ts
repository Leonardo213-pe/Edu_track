import { CollaborationError, DiscussionThread, SubscriberNotifier, TeacherNotifier, accessOf, requireAccess, text, type Access, type NotificationDraft, type ThreadData } from '../domain/forum';
import type { NotificationRequest, NotificationSender } from '../public';
import type { CollaborationAssessments, CollaborationCourses, CollaborationDirectory, CollaborationEnrollment, CollaborationRepository, CollaborationRuntime, ForumRecord } from './ports';

const DUE_SOON_HOURS = 48;
/** CU-05 (participate in forums), CU-09 (moderate) and notifications of replies, due dates and grades (CAR-07). */
export class CollaborationService implements NotificationSender {
  constructor(private readonly repo: CollaborationRepository, private readonly directory: CollaborationDirectory, private readonly courses: CollaborationCourses,
    private readonly enrollments: CollaborationEnrollment, private readonly assessments: CollaborationAssessments, private readonly runtime: CollaborationRuntime) {}

  private async context(actorId: string, courseId: string) {
    const actor = await this.directory.find(actorId); if (!actor) throw new CollaborationError('FORBIDDEN');
    const course = await this.courses.describe(courseId); if (!course) throw new CollaborationError('NOT_FOUND');
    const enrolled = actor.role === 'STUDENT' && await this.enrollments.has(actor.id, courseId);
    const access = accessOf(actor, { courseId, teacherId: course.teacherId, published: course.status === 'PUBLICADO', enrolled });
    return { actor, course, access };
  }
  private async forumContext(actorId: string, forumId: string) {
    const forum = await this.repo.findForum(forumId); if (!forum) throw new CollaborationError('NOT_FOUND');
    return { forum, ...await this.context(actorId, forum.courseId) };
  }
  private async threadContext(actorId: string, threadId: string) {
    const thread = await this.repo.findThread(threadId); if (!thread) throw new CollaborationError('NOT_FOUND');
    return { thread, ...await this.context(actorId, thread.courseId) };
  }
  private async deliver(drafts: readonly NotificationDraft[]): Promise<number> {
    if (!drafts.length) return 0; const now = this.runtime.now();
    return this.repo.notify(drafts.map(draft => ({ ...draft, id: this.runtime.id(), createdAt: now })));
  }

  async forums(actorId: string, courseId: string) {
    const { access, course } = await this.context(actorId, courseId);
    const units = new Map((await this.courses.units(courseId)).map(unit => [unit.id, unit.title]));
    const forums = (await this.repo.forums(courseId)).map(forum => ({ ...forum, unitTitle: forum.unitId ? units.get(forum.unitId) ?? null : null }));
    return { courseId, courseName: course.name, access, units: [...units].map(([id, title]) => ({ id, title })), forums };
  }
  async createForum(actorId: string, courseId: string, input: { title: string; description?: string; unitId?: string | null }) {
    const { actor, access } = await this.context(actorId, courseId); requireAccess(access, 'MODERATE');
    if (input.unitId && !(await this.courses.units(courseId)).some(unit => unit.id === input.unitId)) throw new CollaborationError('INVALID_INPUT');
    const forum: ForumRecord = { id: this.runtime.id(), courseId, unitId: input.unitId ?? null, title: text(input.title, 160), description: text(input.description ?? '', 2000, true),
      createdBy: actor.id, createdAt: this.runtime.now() };
    await this.repo.createForum(forum); return forum;
  }
  async threads(actorId: string, forumId: string) {
    const { forum, access, actor } = await this.forumContext(actorId, forumId);
    const threads = await this.repo.threads(forumId, actor.id); const names = await this.directory.names(threads.map(thread => thread.authorId));
    return { forum, access, threads: threads.map(thread => ({ ...thread, authorName: names.get(thread.authorId) ?? thread.authorId }))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.lastActivityAt.localeCompare(a.lastActivityAt)) };
  }
  /** Opening a thread is its first message; the author is subscribed and the teacher notified. */
  async createThread(actorId: string, forumId: string, input: { title: string; body: string }) {
    const { forum, access, actor, course } = await this.forumContext(actorId, forumId); const now = this.runtime.now();
    const thread: ThreadData = { id: this.runtime.id(), forumId, courseId: forum.courseId, authorId: actor.id, title: text(input.title, 160), pinned: false, locked: false, createdAt: now, lastActivityAt: now };
    const published = new DiscussionThread(thread).subscribe(new TeacherNotifier(course.teacherId))
      .publish({ messageId: this.runtime.id(), authorId: actor.id, body: input.body, postedAt: now, newThread: true }, access);
    await this.repo.createThread(thread, { id: published.event.messageId, threadId: thread.id, authorId: actor.id, body: published.body, createdAt: now, hidden: false, hiddenBy: null, hiddenReason: null });
    await this.deliver(published.notifications); return thread;
  }
  /** Moderated messages keep their place: staff see the text and the reason; participants see a placeholder. */
  async thread(actorId: string, threadId: string) {
    const { thread, access, actor } = await this.threadContext(actorId, threadId);
    const messages = await this.repo.messages(threadId); const subscribers = await this.repo.subscribers(threadId);
    const names = await this.directory.names([...new Set(messages.map(message => message.authorId))]);
    return { thread, access, subscribed: subscribers.includes(actor.id), messages: messages.map(message => ({
      id: message.id, authorId: message.authorId, authorName: names.get(message.authorId) ?? message.authorId, createdAt: message.createdAt, hidden: message.hidden,
      body: message.hidden && access !== 'MODERATE' ? null : message.body, hiddenReason: access === 'MODERATE' ? message.hiddenReason : null })) };
  }
  async reply(actorId: string, threadId: string, body: string) {
    const { thread, access, actor, course } = await this.threadContext(actorId, threadId); const now = this.runtime.now();
    const subscribers = await this.repo.subscribers(threadId);
    const published = new DiscussionThread(thread).subscribe(new TeacherNotifier(course.teacherId)).subscribe(new SubscriberNotifier(subscribers, course.teacherId))
      .publish({ messageId: this.runtime.id(), authorId: actor.id, body, postedAt: now }, access);
    await this.repo.addMessage({ id: published.event.messageId, threadId, authorId: actor.id, body: published.body, createdAt: now, hidden: false, hiddenBy: null, hiddenReason: null });
    await this.deliver(published.notifications); return this.thread(actorId, threadId);
  }
  async subscription(actorId: string, threadId: string, subscribed: boolean) {
    const { access, actor } = await this.threadContext(actorId, threadId); requireAccess(access, 'PARTICIPATE');
    await this.repo.setSubscription(threadId, actor.id, subscribed); return { threadId, subscribed };
  }
  async moderateMessage(actorId: string, messageId: string, input: { hidden: boolean; reason?: string }) {
    const message = await this.repo.findMessage(messageId); if (!message) throw new CollaborationError('NOT_FOUND');
    const { access, actor } = await this.threadContext(actorId, message.threadId); requireAccess(access, 'MODERATE');
    await this.repo.moderateMessage(messageId, input.hidden ? actor.id : null, input.hidden ? text(input.reason, 500) : null);
    return this.thread(actorId, message.threadId);
  }
  async moderateThread(actorId: string, threadId: string, changes: { locked?: boolean; pinned?: boolean }) {
    const { access } = await this.threadContext(actorId, threadId); requireAccess(access, 'MODERATE');
    await this.repo.updateThread(threadId, changes); return this.thread(actorId, threadId);
  }

  async inbox(actorId: string, limit = 50) {
    if (!await this.directory.find(actorId)) throw new CollaborationError('FORBIDDEN');
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new CollaborationError('INVALID_INPUT');
    return { unread: await this.repo.unreadCount(actorId), notifications: await this.repo.notifications(actorId, limit) };
  }
  async markRead(actorId: string, ids: string[] | null) {
    if (!await this.directory.find(actorId)) throw new CollaborationError('FORBIDDEN');
    await this.repo.markRead(actorId, ids, this.runtime.now()); return this.inbox(actorId);
  }
  /** Public contract used by grading (best effort). */
  async notify(requests: readonly NotificationRequest[]): Promise<void> { await this.deliver(requests.map(request => ({ ...request, link: { ...request.link } }))); }
  /** Reminder 48 h before each due date to every enrolled student, once (dedupe key per assessment and student). */
  async remindDueSoon(): Promise<number> {
    const now = new Date(this.runtime.now()); const until = new Date(now.getTime() + DUE_SOON_HOURS * 3_600_000);
    const drafts: NotificationDraft[] = [];
    for (const assessment of await this.assessments.dueBetween(now.toISOString(), until.toISOString())) {
      const course = await this.courses.describe(assessment.courseId); if (course?.status !== 'PUBLICADO') continue;
      for (const studentId of await this.enrollments.studentsOf(assessment.courseId)) drafts.push({ userId: studentId, type: 'DUE_SOON',
        title: `Vence pronto: ${assessment.title}`, body: `${course.name} · cierra el ${new Date(assessment.dueAt).toLocaleString('es-PE', { timeZone: 'America/Lima' })}`,
        link: { courseId: assessment.courseId, assessmentId: assessment.id }, dedupeKey: `DUE:${assessment.id}:${studentId}` });
    }
    return this.deliver(drafts);
  }
}
