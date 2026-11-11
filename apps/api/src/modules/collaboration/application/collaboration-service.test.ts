import { beforeEach, describe, expect, it } from 'vitest';
import { CollaborationService } from './collaboration-service';
import type { Actor, NotificationDraft, ThreadData } from '../domain/forum';
import type { CollaborationRepository, ForumRecord, MessageRecord } from './ports';

const actors: Record<string, Actor> = { teacher: { id: 'teacher', role: 'TEACHER' }, other: { id: 'other', role: 'TEACHER' }, admin: { id: 'admin', role: 'ADMIN' },
  ana: { id: 'ana', role: 'STUDENT' }, beto: { id: 'beto', role: 'STUDENT' }, carla: { id: 'carla', role: 'STUDENT' }, designer: { id: 'designer', role: 'INSTRUCTIONAL_DESIGNER' } };
let forums: ForumRecord[], threads: ThreadData[], messages: MessageRecord[], subs: Set<string>, inbox: (NotificationDraft & { id: string; createdAt: string; readAt: string | null })[];
let service: CollaborationService, enrolled: Set<string>, status: string, now: string;
beforeEach(() => {
  forums = []; threads = []; messages = []; subs = new Set(); inbox = []; enrolled = new Set(['ana', 'beto']); status = 'PUBLICADO'; now = '2026-11-15T10:00:00.000Z';
  // Explicit in-memory double of the persistence port; PostgreSQL is exercised by the integration tests.
  const repo: CollaborationRepository = {
    forums: async courseId => forums.filter(forum => forum.courseId === courseId).map(forum => ({ ...forum, threadCount: threads.filter(thread => thread.forumId === forum.id).length })),
    findForum: async id => forums.find(forum => forum.id === id) ?? null, createForum: async forum => { forums.push(forum); },
    threads: async (forumId, userId) => threads.filter(thread => thread.forumId === forumId).map(thread => ({ ...thread, messageCount: messages.filter(m => m.threadId === thread.id).length, subscribed: subs.has(`${thread.id}:${userId}`) })),
    findThread: async id => threads.find(thread => thread.id === id) ?? null,
    createThread: async (thread, first) => { threads.push(thread); messages.push(first); subs.add(`${thread.id}:${thread.authorId}`); },
    messages: async threadId => messages.filter(message => message.threadId === threadId), findMessage: async id => messages.find(message => message.id === id) ?? null,
    addMessage: async message => { messages.push(message); subs.add(`${message.threadId}:${message.authorId}`); },
    subscribers: async threadId => [...subs].filter(key => key.startsWith(`${threadId}:`)).map(key => key.split(':')[1]!),
    setSubscription: async (threadId, userId, on) => { if (on) subs.add(`${threadId}:${userId}`); else subs.delete(`${threadId}:${userId}`); },
    moderateMessage: async (id, hiddenBy, reason) => { const message = messages.find(item => item.id === id)!; Object.assign(message, { hidden: !!hiddenBy, hiddenBy, hiddenReason: reason }); },
    updateThread: async (id, changes) => { const index = threads.findIndex(thread => thread.id === id); threads[index] = { ...threads[index]!, ...changes }; },
    notify: async drafts => { let count = 0; for (const draft of drafts) if (!draft.dedupeKey || !inbox.some(item => item.dedupeKey === draft.dedupeKey)) { inbox.push({ ...draft, readAt: null }); count++; } return count; },
    notifications: async (userId, limit) => inbox.filter(item => item.userId === userId).slice(0, limit).map(({ userId: _u, dedupeKey: _d, ...rest }) => rest),
    unreadCount: async userId => inbox.filter(item => item.userId === userId && !item.readAt).length,
    markRead: async (userId, ids, at) => { for (const item of inbox) if (item.userId === userId && (!ids || ids.includes(item.id))) item.readAt = at; },
  };
  let id = 0;
  service = new CollaborationService(repo, { find: async id => actors[id] ?? null, names: async ids => new Map(ids.map(item => [item, item.toUpperCase()])) },
    { describe: async id => id === 'course' ? { id, code: 'CS-1', name: 'Curso', teacherId: 'teacher', status } : null, units: async () => [{ id: 'unit-1', title: 'Unidad 1' }] },
    { has: async studentId => enrolled.has(studentId), studentsOf: async () => [...enrolled] },
    { dueBetween: async () => [{ id: 'quiz', courseId: 'course', title: 'Práctica', dueAt: '2026-11-16T15:00:00.000Z' }] },
    { id: () => `id-${++id}`, now: () => now });
});
async function forumWithThread() {
  const forum = await service.createForum('teacher', 'course', { title: 'Consultas', unitId: 'unit-1' });
  const thread = await service.createThread('ana', forum.id, { title: 'Duda', body: '¿Cómo se calcula el promedio?' });
  return { forum, thread };
}
describe('forum use cases', () => {
  it('creates forums per course or unit only as moderator and lists them with access', async () => {
    const { forum } = await forumWithThread();
    expect((await service.forums('ana', 'course'))).toMatchObject({ access: 'PARTICIPATE', forums: [{ id: forum.id, unitTitle: 'Unidad 1', threadCount: 1 }] });
    await expect(service.createForum('ana', 'course', { title: 'X' })).rejects.toThrow('FORBIDDEN');
    await expect(service.createForum('teacher', 'course', { title: 'X', unitId: 'foreign' })).rejects.toThrow('INVALID_INPUT');
    await expect(service.forums('carla', 'course')).rejects.toThrow('FORBIDDEN'); await expect(service.forums('teacher', 'missing')).rejects.toThrow('NOT_FOUND');
    await expect(service.forums('ghost', 'course')).rejects.toThrow('FORBIDDEN');
    expect((await service.forums('designer', 'course')).access).toBe('READ');
  });
  it('subscribes authors, notifies teacher and subscribers on replies and respects unsubscribe', async () => {
    const { thread } = await forumWithThread();
    expect(inbox.map(item => [item.userId, item.type])).toEqual([['teacher', 'FORUM_NEW_THREAD']]);
    await service.reply('beto', thread.id, 'Con los pesos de cada evaluación.');
    expect(inbox.slice(1).map(item => [item.userId, item.type])).toEqual([['teacher', 'FORUM_REPLY'], ['ana', 'FORUM_REPLY']]);
    await service.subscription('ana', thread.id, false); await service.reply('teacher', thread.id, 'Correcto.');
    expect(inbox.slice(3).map(item => item.userId)).toEqual(['beto']);
    await expect(service.subscription('designer', thread.id, true)).rejects.toThrow('FORBIDDEN');
    const view = await service.thread('ana', thread.id); expect(view.messages.map(message => message.authorName)).toEqual(['ANA', 'BETO', 'TEACHER']); expect(view.subscribed).toBe(false);
    await expect(service.reply('designer', thread.id, 'Hola')).rejects.toThrow('FORBIDDEN'); await expect(service.thread('ana', 'missing')).rejects.toThrow('NOT_FOUND');
  });
  it('moderates: hidden messages keep their place, lock blocks participants, pin sorts first', async () => {
    const { forum, thread } = await forumWithThread(); const reply = (await service.reply('beto', thread.id, 'Contenido ofensivo')).messages[1]!;
    await expect(service.moderateMessage('ana', reply.id, { hidden: true, reason: 'x' })).rejects.toThrow('FORBIDDEN');
    await expect(service.moderateMessage('teacher', reply.id, { hidden: true })).rejects.toThrow('INVALID_INPUT');
    const moderated = await service.moderateMessage('teacher', reply.id, { hidden: true, reason: 'Lenguaje inapropiado' });
    expect(moderated.messages[1]).toMatchObject({ hidden: true, body: 'Contenido ofensivo', hiddenReason: 'Lenguaje inapropiado' });
    expect((await service.thread('ana', thread.id)).messages[1]).toMatchObject({ hidden: true, body: null, hiddenReason: null });
    expect((await service.moderateMessage('admin', reply.id, { hidden: false })).messages[1]!.hidden).toBe(false);
    await service.moderateThread('teacher', thread.id, { locked: true });
    await expect(service.reply('beto', thread.id, 'Hola')).rejects.toThrow('LOCKED'); await service.reply('teacher', thread.id, 'Hilo cerrado');
    const second = await service.createThread('beto', forum.id, { title: 'Otro', body: 'Mensaje' }); now = '2026-11-15T11:00:00.000Z';
    await service.moderateThread('teacher', thread.id, { pinned: true });
    expect((await service.threads('ana', forum.id)).threads.map(item => item.id)).toEqual([thread.id, second.id]);
    await expect(service.moderateThread('beto', thread.id, { pinned: false })).rejects.toThrow('FORBIDDEN'); await expect(service.moderateMessage('teacher', 'missing', { hidden: false })).rejects.toThrow('NOT_FOUND');
  });
  it('keeps an inbox with unread count and sends due-date reminders once per student', async () => {
    expect(await service.remindDueSoon()).toBe(2); expect(await service.remindDueSoon()).toBe(0);
    status = 'ARCHIVADO'; expect(await service.remindDueSoon()).toBe(0);
    await service.notify([{ userId: 'ana', type: 'GRADE', title: 'Nota registrada: Práctica', body: 'Tu nota es 15 / 20.', link: { courseId: 'course' } }]);
    const mine = await service.inbox('ana'); expect(mine.unread).toBe(2); expect(mine.notifications.map(item => item.type).sort()).toEqual(['DUE_SOON', 'GRADE']);
    expect((await service.markRead('ana', [mine.notifications[0]!.id])).unread).toBe(1); expect((await service.markRead('ana', null)).unread).toBe(0);
    await expect(service.inbox('ana', 0)).rejects.toThrow('INVALID_INPUT'); await expect(service.inbox('ghost')).rejects.toThrow('FORBIDDEN'); await expect(service.markRead('ghost', null)).rejects.toThrow('FORBIDDEN');
  });
});
