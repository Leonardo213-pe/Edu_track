import type { Actor, NotificationDraft, ThreadData } from '../domain/forum';
export interface ForumRecord { id: string; courseId: string; unitId: string | null; title: string; description: string; createdBy: string; createdAt: string }
export interface MessageRecord { id: string; threadId: string; authorId: string; body: string; createdAt: string; hidden: boolean; hiddenBy: string | null; hiddenReason: string | null }
export interface NotificationRecord { id: string; type: string; title: string; body: string; link: Record<string, string>; createdAt: string; readAt: string | null }
export interface CollaborationRepository {
  forums(courseId: string): Promise<(ForumRecord & { threadCount: number })[]>;
  findForum(id: string): Promise<ForumRecord | null>;
  createForum(forum: ForumRecord): Promise<void>;
  threads(forumId: string, userId: string): Promise<(ThreadData & { messageCount: number; subscribed: boolean })[]>;
  findThread(id: string): Promise<ThreadData | null>;
  /** Thread, first message and the author's subscription in one transaction. */
  createThread(thread: ThreadData, first: MessageRecord): Promise<void>;
  messages(threadId: string): Promise<MessageRecord[]>;
  findMessage(id: string): Promise<MessageRecord | null>;
  /** Stores the reply, refreshes the thread activity and subscribes the author, atomically. */
  addMessage(message: MessageRecord): Promise<void>;
  subscribers(threadId: string): Promise<string[]>;
  setSubscription(threadId: string, userId: string, subscribed: boolean): Promise<void>;
  moderateMessage(id: string, hiddenBy: string | null, reason: string | null): Promise<void>;
  updateThread(id: string, changes: { locked?: boolean; pinned?: boolean }): Promise<void>;
  /** Inserts notifications; drafts with an already used dedupe key are ignored (idempotent reminders). */
  notify(drafts: readonly (NotificationDraft & { id: string; createdAt: string })[]): Promise<number>;
  notifications(userId: string, limit: number): Promise<NotificationRecord[]>;
  unreadCount(userId: string): Promise<number>;
  markRead(userId: string, ids: string[] | null, at: string): Promise<void>;
}
export interface CollaborationDirectory { find(id: string): Promise<Actor | null>; names(ids: string[]): Promise<Map<string, string>> }
export interface CollaborationCourses {
  describe(courseId: string): Promise<{ id: string; code: string; name: string; teacherId: string; status: string } | null>;
  units(courseId: string): Promise<{ id: string; title: string }[]>;
}
export interface CollaborationEnrollment { has(studentId: string, courseId: string): Promise<boolean>; studentsOf(courseId: string): Promise<string[]> }
export interface CollaborationAssessments { dueBetween(from: string, to: string): Promise<{ id: string; courseId: string; title: string; dueAt: string }[]> }
export interface CollaborationRuntime { id(): string; now(): string }
