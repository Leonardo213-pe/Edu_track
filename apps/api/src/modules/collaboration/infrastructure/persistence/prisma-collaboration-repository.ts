import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Prisma } from './generated/client';
import type { NotificationDraft, ThreadData } from '../../domain/forum';
import type { CollaborationRepository, ForumRecord, MessageRecord, NotificationRecord } from '../../application/ports';

const iso = (date: Date | null) => date ? date.toISOString() : null;
export class PrismaCollaborationRepository implements CollaborationRepository {
  private readonly db: PrismaClient;
  constructor(url: string) { this.db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max: 5, connectionTimeoutMillis: 5000 }) }); }
  private forum(row: Prisma.ForumGetPayload<object>): ForumRecord { return { ...row, createdAt: row.createdAt.toISOString() }; }
  private thread(row: Prisma.ForumThreadGetPayload<{ include: { forum: { select: { courseId: true } } } }>): ThreadData {
    const { forum, ...data } = row; return { ...data, courseId: forum.courseId, createdAt: row.createdAt.toISOString(), lastActivityAt: row.lastActivityAt.toISOString() };
  }
  private message(row: Prisma.ForumMessageGetPayload<object>): MessageRecord { return { ...row, createdAt: row.createdAt.toISOString() }; }

  async forums(courseId: string) {
    const rows = await this.db.forum.findMany({ where: { courseId }, include: { _count: { select: { threads: true } } }, orderBy: { createdAt: 'asc' } });
    return rows.map(({ _count, ...row }) => ({ ...this.forum(row), threadCount: _count.threads }));
  }
  async findForum(id: string) { const row = await this.db.forum.findUnique({ where: { id } }); return row ? this.forum(row) : null; }
  async createForum(forum: ForumRecord) { await this.db.forum.create({ data: { ...forum, createdAt: new Date(forum.createdAt) } }); }
  async threads(forumId: string, userId: string) {
    const rows = await this.db.forumThread.findMany({ where: { forumId }, include: { forum: { select: { courseId: true } }, _count: { select: { messages: true } },
      subscriptions: { where: { userId }, select: { userId: true } } } });
    return rows.map(({ _count, subscriptions, ...row }) => ({ ...this.thread(row), messageCount: _count.messages, subscribed: subscriptions.length > 0 }));
  }
  async findThread(id: string) {
    const row = await this.db.forumThread.findUnique({ where: { id }, include: { forum: { select: { courseId: true } } } }); return row ? this.thread(row) : null;
  }
  async createThread(thread: ThreadData, first: MessageRecord) {
    const { courseId, ...data } = thread; const at = new Date(thread.createdAt);
    await this.db.$transaction([
      this.db.forumThread.create({ data: { ...data, createdAt: at, lastActivityAt: at } }),
      this.db.forumMessage.create({ data: { ...first, createdAt: new Date(first.createdAt) } }),
      this.db.threadSubscription.create({ data: { threadId: thread.id, userId: thread.authorId, createdAt: at } }),
    ]);
  }
  async messages(threadId: string) {
    return (await this.db.forumMessage.findMany({ where: { threadId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })).map(row => this.message(row));
  }
  async findMessage(id: string) { const row = await this.db.forumMessage.findUnique({ where: { id } }); return row ? this.message(row) : null; }
  async addMessage(message: MessageRecord) {
    const at = new Date(message.createdAt);
    await this.db.$transaction([
      this.db.forumMessage.create({ data: { ...message, createdAt: at } }),
      this.db.forumThread.update({ where: { id: message.threadId }, data: { lastActivityAt: at } }),
      this.db.threadSubscription.upsert({ where: { threadId_userId: { threadId: message.threadId, userId: message.authorId } },
        create: { threadId: message.threadId, userId: message.authorId, createdAt: at }, update: {} }),
    ]);
  }
  async subscribers(threadId: string) { return (await this.db.threadSubscription.findMany({ where: { threadId }, select: { userId: true } })).map(row => row.userId); }
  async setSubscription(threadId: string, userId: string, subscribed: boolean) {
    if (subscribed) await this.db.threadSubscription.upsert({ where: { threadId_userId: { threadId, userId } }, create: { threadId, userId, createdAt: new Date() }, update: {} });
    else await this.db.threadSubscription.deleteMany({ where: { threadId, userId } });
  }
  async moderateMessage(id: string, hiddenBy: string | null, reason: string | null) {
    await this.db.forumMessage.update({ where: { id }, data: { hidden: hiddenBy !== null, hiddenBy, hiddenReason: reason } });
  }
  async updateThread(id: string, changes: { locked?: boolean; pinned?: boolean }) { await this.db.forumThread.update({ where: { id }, data: changes }); }
  async notify(drafts: readonly (NotificationDraft & { id: string; createdAt: string })[]) {
    const result = await this.db.notification.createMany({ skipDuplicates: true, data: drafts.map(draft => ({ id: draft.id, userId: draft.userId, type: draft.type,
      title: draft.title.slice(0, 200), body: draft.body.slice(0, 1000), link: draft.link as Prisma.InputJsonValue, dedupeKey: draft.dedupeKey ?? null, createdAt: new Date(draft.createdAt) })) });
    return result.count;
  }
  async notifications(userId: string, limit: number): Promise<NotificationRecord[]> {
    const rows = await this.db.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: limit });
    return rows.map(row => ({ id: row.id, type: row.type, title: row.title, body: row.body, link: row.link as Record<string, string>, createdAt: row.createdAt.toISOString(), readAt: iso(row.readAt) }));
  }
  unreadCount(userId: string) { return this.db.notification.count({ where: { userId, readAt: null } }); }
  async markRead(userId: string, ids: string[] | null, at: string) {
    await this.db.notification.updateMany({ where: { userId, readAt: null, ...(ids ? { id: { in: ids } } : {}) }, data: { readAt: new Date(at) } });
  }
  async onModuleDestroy() { await this.db.$disconnect(); }
}
