import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Course, CourseError, type Actor } from '../domain/course';
import { CourseService } from './course-service';
import type { CourseHistoryEntry, CourseRepository, CourseStorage } from './ports';
const teacher = { id: 'teacher', role: 'TEACHER' as const }, designer = { id: 'designer', role: 'INSTRUCTIONAL_DESIGNER' as const }, student = { id: 'student', role: 'STUDENT' as const };
let course: Course, service: CourseService, repo: CourseRepository, storage: CourseStorage, completed: Set<string>, enroll: boolean, principals: Map<string, Actor>;
let store: Map<string, Course>, history: CourseHistoryEntry[];
const pdf = () => ({ bytes: new Uint8Array([1]), filename: 'test.pdf', mimeType: 'application/pdf' });
beforeEach(() => {
  course = Course.create({ id: 'course', code: 'CS-1', name: 'Curso', description: 'Detalle', period: '2026', teacherId: teacher.id, createdAt: '2026-11-11' });
  completed = new Set(); enroll = true; store = new Map([[course.data.id, course]]); history = [];
  principals = new Map([teacher, designer, student, { id: 'other', role: 'TEACHER' as const }, { id: 'admin', role: 'ADMIN' as const }].map(actor => [actor.id, actor]));
  // Explicit in-memory test double of the persistence port; integration tests exercise PostgreSQL.
  const persistChanges = (target: Course) => { for (const change of target.takeChanges()) history.push({ ...change, id: `h${history.length}`, revision: target.data.revision, createdAt: '2026-11-11T00:00:00Z' }); };
  repo = {
    create: vi.fn(async (created: Course) => { store.set(created.data.id, created); persistChanges(created); }),
    find: vi.fn(async id => store.get(id) ?? null),
    list: vi.fn(async (filter = {}) => [...store.values()].filter(item => (!filter.teacherId || item.data.teacherId === filter.teacherId)
      && (!filter.ids || filter.ids.includes(item.data.id)) && (!filter.statuses || filter.statuses.includes(item.data.status)))),
    mutate: async (id, revision, work) => {
      const target = store.get(id); if (!target) throw new CourseError('NOT_FOUND'); if (target.data.revision !== revision) throw new CourseError('CONFLICT');
      await work(target); target.advanceRevision(); persistChanges(target); return target;
    },
    history: async () => history,
    completed: async () => [...completed], complete: async (_user, _course, _material, version) => { completed.add(version); },
    activity: async () => [{ userId: student.id, versions: [...completed] }],
  };
  storage = { put: vi.fn(async () => ({ key: 'private-key', filename: 'material.pdf', mimeType: 'application/pdf', size: 10, sha256: 'hash' })), remove: vi.fn(async () => {}), read: vi.fn(async () => new Uint8Array([1, 2])) };
  let id = 0;
  service = new CourseService(repo, { find: async actorId => principals.get(actorId) ?? null, teachers: async () => [{ id: teacher.id, displayName: 'Docente' }],
    names: async ids => new Map(ids.filter(item => principals.has(item)).map(item => [item, `Nombre ${item}`])) },
  { has: async () => enroll, courses: async () => enroll ? [...store.keys()] : [] }, storage, { id: () => `id-${++id}`, now: () => '2026-11-11T00:00:00Z' });
});
async function prepare() {
  await service.edit(teacher.id, 'course', course.data.revision, { ...course.data, syllabus: 'Sílabo' }); await service.unit(teacher.id, 'course', course.data.revision, 'Unidad');
  const unit = course.data.units[0]!;
  await service.session(teacher.id, 'course', course.data.revision, unit.id, { title: 'Sesión', description: '', durationMinutes: 60 }); const session = course.data.units[0]!.sessions[0]!;
  await service.material(teacher.id, 'course', course.data.revision, session.id, { title: 'Material', kind: 'FILE' }, pdf());
  return { unit: course.data.units[0]!, session: course.data.units[0]!.sessions[0]!, material: course.data.units[0]!.sessions[0]!.materials[0]! };
}
async function publish() {
  await service.transition(teacher.id, 'course', course.data.revision, 'SUBMITTED', ''); await service.transition(designer.id, 'course', course.data.revision, 'APPROVED', '');
}
describe('course use cases through ports', () => {
  it('creates drafts, records the creation, validates responsible teachers and denies unauthorized creation', async () => {
    const created = await service.create(teacher.id, course.data);
    expect(created).toMatchObject({ teacherId: teacher.id, status: 'BORRADOR', teacherName: 'Nombre teacher', durationMinutes: 0, removable: true });
    expect(history.map(entry => entry.action)).toEqual(['COURSE_CREATED']);
    await expect(service.create(student.id, course.data)).rejects.toThrow('FORBIDDEN');
    await expect(service.create(teacher.id, { ...course.data, teacherId: 'other' })).rejects.toThrow('FORBIDDEN');
    await expect(service.create('admin', { ...course.data, teacherId: student.id })).rejects.toThrow('INVALID_INPUT');
    await expect(service.list('missing')).rejects.toThrow('FORBIDDEN');
  });
  it('edits and orders the structure without infrastructure dependencies', async () => {
    const { unit, session } = await prepare(); await service.unit(teacher.id, 'course', course.data.revision, 'Nueva unidad', unit.id);
    await service.session(teacher.id, 'course', course.data.revision, unit.id, { title: 'Nueva sesión', description: 'Detalle', durationMinutes: 30 }, session.id);
    const view = await service.reorder(teacher.id, 'course', course.data.revision, 'sessions', unit.id, [session.id]);
    expect(course.session(session.id).title).toBe('Nueva sesión'); expect(view.durationMinutes).toBe(30);
    await expect(service.edit(teacher.id, 'course', course.data.revision, { ...course.data, teacherId: student.id })).rejects.toThrow('INVALID_INPUT');
    await expect(service.unit(teacher.id, 'course', -1, 'Bad')).rejects.toThrow('INVALID_INPUT');
  });
  it('filters listings in the store by role, ownership, publication and enrollment', async () => {
    expect(await service.list(student.id)).toEqual([]); expect(await service.list('other')).toEqual([]); expect(await service.list(designer.id)).toHaveLength(1);
    expect(repo.list).toHaveBeenLastCalledWith({});
    await service.list('other'); expect(repo.list).toHaveBeenLastCalledWith({ teacherId: 'other' });
    expect(await service.findPublished('course')).toBeNull(); await prepare(); await publish();
    expect(await service.findPublished('course')).toMatchObject({ code: 'CS-1' });
    const [summary] = await service.list(student.id); expect(summary).toMatchObject({ teacherName: 'Nombre teacher', unitCount: 1, sessionCount: 1, durationMinutes: 60, progress: { percentage: 0 } });
    expect(repo.list).toHaveBeenLastCalledWith({ ids: ['course'], statuses: ['PUBLICADO'] });
    enroll = false; expect(await service.list(student.id)).toHaveLength(0);
    await expect(service.get(student.id, 'course')).rejects.toThrow('FORBIDDEN'); await expect(service.get(teacher.id, 'missing')).rejects.toThrow('NOT_FOUND');
  });
  it('retains file versions, hides storage keys and restricts student access to current content', async () => {
    const { session, material } = await prepare(); const original = material.versions[0]!;
    await service.material(teacher.id, 'course', course.data.revision, session.id, { title: 'Nueva', materialId: material.id, kind: 'LINK', url: 'https://example.test' });
    const managerView = await service.get(teacher.id, 'course'); expect(managerView.units[0]!.sessions[0]!.materials[0]!.versions[0]!.storageKey).toBeNull();
    expect(course.material(material.id).versions[0]!.storageKey).toBe('private-key');
    expect((await service.download(teacher.id, 'course', material.id, original.id)).bytes).toEqual(new Uint8Array([1, 2]));
    await publish();
    const view = await service.get(student.id, 'course'); expect(view.units[0]!.sessions[0]!.materials[0]!.versions).toHaveLength(1); expect(view.reviews).toHaveLength(0);
    expect(view.removable).toBeUndefined();
    await expect(service.download(student.id, 'course', material.id, original.id)).rejects.toThrow('NOT_FOUND');
    await expect(service.download(teacher.id, 'missing', material.id, original.id)).rejects.toThrow('NOT_FOUND');
  });
  it('persists idempotent completion and reports actual activity with names to managers', async () => {
    const { material } = await prepare(); await publish();
    expect((await service.complete(student.id, 'course', material.id)).progress?.percentage).toBe(100); await service.complete(student.id, 'course', material.id); expect(completed.size).toBe(1);
    expect(await service.activity(teacher.id, 'course')).toMatchObject([{ percentage: 100, displayName: 'Nombre student' }]);
    await expect(service.complete(teacher.id, 'course', material.id)).rejects.toThrow('FORBIDDEN');
    await expect(service.complete(student.id, 'missing', material.id)).rejects.toThrow('NOT_FOUND'); await expect(service.activity(student.id, 'course')).rejects.toThrow('FORBIDDEN');
    await expect(service.activity('admin', 'missing')).rejects.toThrow('NOT_FOUND');
    expect(await service.teachers('admin')).toHaveLength(1); await expect(service.teachers(student.id)).rejects.toThrow('FORBIDDEN');
  });
  it('cleans up a stored file on conflicts and rejects wrong-session material updates', async () => {
    const { unit, session, material } = await prepare(); await service.session(teacher.id, 'course', course.data.revision, unit.id, { title: 'Otra', description: '' });
    const other = course.data.units[0]!.sessions[1]!;
    await expect(service.material(teacher.id, 'course', course.data.revision, other.id, { title: 'No', kind: 'FILE', materialId: material.id }, pdf())).rejects.toThrow('NOT_FOUND');
    expect(storage.remove).toHaveBeenCalledWith('private-key');
    await expect(service.material(teacher.id, 'course', 0, session.id, { title: 'No', kind: 'FILE' }, pdf())).rejects.toThrow('CONFLICT');
    await expect(service.material(teacher.id, 'course', course.data.revision, session.id, { title: 'No', kind: 'FILE' })).rejects.toThrow('FILE_REJECTED');
    await expect(service.material(teacher.id, 'course', course.data.revision, session.id, { title: 'No', kind: 'LINK' }, pdf())).rejects.toThrow('FILE_REJECTED');
    await expect(service.material(teacher.id, 'missing', 0, session.id, { title: 'No', kind: 'LINK' })).rejects.toThrow('NOT_FOUND');
  });
  it('authorizes uploads before bytes are received', async () => {
    const { session } = await prepare();
    await expect(service.authorizeUpload(student.id, 'course', session.id)).rejects.toThrow('FORBIDDEN');
    await expect(service.authorizeUpload('other', 'course', session.id)).rejects.toThrow('FORBIDDEN');
    await expect(service.authorizeUpload(teacher.id, 'course', 'missing')).rejects.toThrow('NOT_FOUND');
    await expect(service.authorizeUpload(teacher.id, 'course', session.id)).resolves.toBeUndefined();
    await service.transition(teacher.id, 'course', course.data.revision, 'SUBMITTED', '');
    await expect(service.authorizeUpload(teacher.id, 'course', session.id)).rejects.toThrow('INVALID_STATE');
  });
  it('removes draft structure, deletes its stored files after commit and exposes the history only to staff', async () => {
    const { unit } = await prepare();
    const view = await service.remove(teacher.id, 'course', course.data.revision, 'units', unit.id);
    expect(view.units).toHaveLength(0); expect(storage.remove).toHaveBeenCalledWith('private-key');
    vi.mocked(storage.remove).mockRejectedValueOnce(new Error('disk'));
    await service.unit(teacher.id, 'course', course.data.revision, 'Unidad'); await service.session(teacher.id, 'course', course.data.revision, course.data.units[0]!.id, { title: 'S', description: '' });
    await service.material(teacher.id, 'course', course.data.revision, course.data.units[0]!.sessions[0]!.id, { title: 'M', kind: 'FILE' }, pdf());
    await expect(service.remove(teacher.id, 'course', course.data.revision, 'materials', course.data.units[0]!.sessions[0]!.materials[0]!.id)).resolves.toBeTruthy();
    await service.remove(teacher.id, 'course', course.data.revision, 'sessions', course.data.units[0]!.sessions[0]!.id);
    await expect(service.remove('other', 'course', course.data.revision, 'units', course.data.units[0]!.id)).rejects.toThrow('FORBIDDEN');
    const entries = await service.history(designer.id, 'course');
    expect(entries.map(entry => entry.action)).toContain('UNIT_REMOVED'); expect(entries[0]).toMatchObject({ actorName: 'Nombre teacher' });
    expect(await service.history('admin', 'course')).toHaveLength(entries.length);
    await expect(service.history(student.id, 'course')).rejects.toThrow('FORBIDDEN'); await expect(service.history('other', 'course')).rejects.toThrow('FORBIDDEN');
  });
});
