import { describe, expect, it } from 'vitest';
import { DiscussionThread, SubscriberNotifier, TeacherNotifier, accessOf, requireAccess, text, type ThreadData } from './forum';

const course = { courseId: 'course', teacherId: 'teacher', published: true, enrolled: true };
const thread: ThreadData = { id: 'thread', forumId: 'forum', courseId: 'course', authorId: 'ana', title: 'Dudas de la unidad 1', pinned: false, locked: false,
  createdAt: '2026-11-15T10:00:00.000Z', lastActivityAt: '2026-11-15T10:00:00.000Z' };
describe('forum rules', () => {
  it('grants moderation to the teacher and admin, participation to enrolled students and reading to designers', () => {
    expect(accessOf({ id: 'teacher', role: 'TEACHER' }, course)).toBe('MODERATE'); expect(accessOf({ id: 'x', role: 'ADMIN' }, course)).toBe('MODERATE');
    expect(accessOf({ id: 'ana', role: 'STUDENT' }, course)).toBe('PARTICIPATE'); expect(accessOf({ id: 'd', role: 'INSTRUCTIONAL_DESIGNER' }, course)).toBe('READ');
    for (const [actor, context] of [[{ id: 'other', role: 'TEACHER' }, course], [{ id: 'ana', role: 'STUDENT' }, { ...course, enrolled: false }],
      [{ id: 'ana', role: 'STUDENT' }, { ...course, published: false }]] as const) expect(() => accessOf(actor, context)).toThrow('FORBIDDEN');
    expect(() => requireAccess('READ', 'PARTICIPATE')).toThrow('FORBIDDEN'); expect(() => requireAccess('MODERATE', 'PARTICIPATE')).not.toThrow();
    expect(text('  hola ', 10)).toBe('hola'); expect(() => text(' ', 10)).toThrow('INVALID_INPUT'); expect(() => text('x'.repeat(11), 10)).toThrow('INVALID_INPUT');
  });
  it('notifies the teacher of new threads and subscribers of replies through observers (Observer)', () => {
    const opened = new DiscussionThread(thread).subscribe(new TeacherNotifier('teacher'))
      .publish({ messageId: 'm1', authorId: 'ana', body: 'Tengo una duda', postedAt: thread.createdAt, newThread: true }, 'PARTICIPATE');
    expect(opened.notifications).toEqual([expect.objectContaining({ userId: 'teacher', type: 'FORUM_NEW_THREAD', dedupeKey: 'm1:teacher', link: { courseId: 'course', forumId: 'forum', threadId: 'thread' } })]);
    const reply = new DiscussionThread(thread).subscribe(new TeacherNotifier('teacher')).subscribe(new SubscriberNotifier(['ana', 'beto', 'beto', 'teacher'], 'teacher'))
      .publish({ messageId: 'm2', authorId: 'beto', body: 'x'.repeat(300), postedAt: thread.createdAt }, 'PARTICIPATE');
    expect(reply.notifications.map(item => [item.userId, item.type])).toEqual([['teacher', 'FORUM_REPLY'], ['ana', 'FORUM_REPLY']]);
    expect(reply.event.excerpt).toHaveLength(178);
    const byTeacher = new DiscussionThread(thread).subscribe(new TeacherNotifier('teacher')).subscribe(new SubscriberNotifier(['ana'], 'teacher'))
      .publish({ messageId: 'm3', authorId: 'teacher', body: 'Respuesta', postedAt: thread.createdAt }, 'MODERATE');
    expect(byTeacher.notifications.map(item => item.userId)).toEqual(['ana']);
  });
  it('rejects posts in locked threads except for moderators, empty bodies and read-only access', () => {
    const locked = new DiscussionThread({ ...thread, locked: true });
    expect(() => locked.publish({ messageId: 'm', authorId: 'ana', body: 'Hola', postedAt: '' }, 'PARTICIPATE')).toThrow('LOCKED');
    expect(locked.publish({ messageId: 'm', authorId: 'teacher', body: 'Cierre', postedAt: '' }, 'MODERATE').body).toBe('Cierre');
    expect(() => new DiscussionThread(thread).publish({ messageId: 'm', authorId: 'd', body: 'Hola', postedAt: '' }, 'READ')).toThrow('FORBIDDEN');
    expect(() => new DiscussionThread(thread).publish({ messageId: 'm', authorId: 'ana', body: '  ', postedAt: '' }, 'PARTICIPATE')).toThrow('INVALID_INPUT');
  });
});
