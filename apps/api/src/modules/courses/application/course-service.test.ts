import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Course, CourseError, type Actor } from '../domain/course';
import { CourseService } from './course-service';
import type { CourseRepository, CourseStorage } from './ports';
const teacher = { id: 'teacher', role: 'TEACHER' as const }, designer = { id: 'designer', role: 'INSTRUCTIONAL_DESIGNER' as const }, student = { id: 'student', role: 'STUDENT' as const };
let course: Course, service: CourseService, repo: CourseRepository, storage: CourseStorage, completed: Set<string>, enroll: boolean, principals: Map<string, Actor>;
beforeEach(() => {
  course = Course.create({ id: 'course', code: 'CS-1', name: 'Curso', description: 'Detalle', period: '2026', teacherId: teacher.id, createdAt: '2026-11-11' }); completed = new Set(); enroll = true;
  principals = new Map([teacher, designer, student, { id: 'other', role: 'TEACHER' as const }, { id: 'admin', role: 'ADMIN' as const }].map(actor => [actor.id, actor]));
  repo = { create: vi.fn(async () => {}), find: vi.fn(async id => id === course.data.id ? course : null), list: async () => [course],
    mutate: async (id, revision, work) => { if (id !== course.data.id) throw new CourseError('NOT_FOUND'); if (course.data.revision !== revision) throw new CourseError('CONFLICT'); await work(course); course.data.revision++; return course; },
    completed: async () => [...completed], complete: async (_user, _course, _material, version) => { completed.add(version); }, activity: async () => [{ userId: student.id, versions: [...completed] }],
  };
  storage = { put: vi.fn(async () => ({ key: 'private-key', filename: 'material.pdf', mimeType: 'application/pdf', size: 10, sha256: 'hash' })), remove: vi.fn(async () => {}), read: vi.fn(async () => new Uint8Array([1, 2])) };
  let id = 0; service = new CourseService(repo, { find: async id => principals.get(id) ?? null, teachers: async () => [{ id: teacher.id, displayName: 'Docente' }] }, { has: async () => enroll }, storage, { id: () => `id-${++id}`, now: () => '2026-11-11T00:00:00Z' });
});
async function prepare() { await service.edit(teacher.id, 'course', course.data.revision, { ...course.data, syllabus: 'Sílabo' }); await service.unit(teacher.id, 'course', course.data.revision, 'Unidad'); const unit = course.data.units[0]!;
  await service.session(teacher.id, 'course', course.data.revision, unit.id, 'Sesión', ''); const session = unit.sessions[0]!;
  await service.material(teacher.id, 'course', course.data.revision, session.id, { title: 'Material', kind: 'FILE' }, { bytes: new Uint8Array([1]), filename: 'test.pdf', mimeType: 'application/pdf' }); return { unit, session, material: session.materials[0]! }; }
describe('course use cases through ports', () => {
  it('creates drafts, validates responsible teachers and denies unauthorized creation', async () => {
    expect(await service.create(teacher.id, course.data)).toMatchObject({ teacherId: teacher.id, status: 'BORRADOR' }); expect(repo.create).toHaveBeenCalled();
    await expect(service.create(student.id, course.data)).rejects.toThrow('FORBIDDEN');
    await expect(service.create(teacher.id, { ...course.data, teacherId: 'other' })).rejects.toThrow('FORBIDDEN');
    await expect(service.create('admin', { ...course.data, teacherId: student.id })).rejects.toThrow('INVALID_INPUT');
    await expect(service.list('missing')).rejects.toThrow('FORBIDDEN');
  });
  it('edits and orders the structure without infrastructure dependencies', async () => {
    const { unit, session } = await prepare(); await service.unit(teacher.id, 'course', course.data.revision, 'Nueva unidad', unit.id);
    await service.session(teacher.id, 'course', course.data.revision, unit.id, 'Nueva sesión', 'Detalle', session.id);
    await service.reorder(teacher.id, 'course', course.data.revision, 'sessions', unit.id, [session.id]); expect(session.title).toBe('Nueva sesión');
    await expect(service.edit(teacher.id, 'course', course.data.revision, { ...course.data, teacherId: student.id })).rejects.toThrow('INVALID_INPUT');
    await expect(service.unit(teacher.id, 'course', -1, 'Bad')).rejects.toThrow('INVALID_INPUT');
  });
  it('filters course listings by role, publication and enrollment', async () => {
    expect(await service.list(student.id)).toEqual([]); expect(await service.list('other')).toEqual([]); expect(await service.list(designer.id)).toHaveLength(1);
    expect(await service.findPublished('course')).toBeNull(); await prepare(); await service.transition(teacher.id, 'course', course.data.revision, 'SUBMITTED', ''); await service.transition(designer.id, 'course', course.data.revision, 'APPROVED', '');
    expect(await service.findPublished('course')).toMatchObject({ code: 'CS-1' }); expect(await service.list(student.id)).toHaveLength(1); enroll = false;
    expect(await service.list(student.id)).toHaveLength(0); await expect(service.get(student.id, 'course')).rejects.toThrow('FORBIDDEN'); await expect(service.get(teacher.id, 'missing')).rejects.toThrow('NOT_FOUND');
  });
  it('retains file versions, hides storage keys and restricts student access to current content', async () => {
    const { session, material } = await prepare(); const original = material.versions[0]!;
    await service.material(teacher.id, 'course', course.data.revision, session.id, { title: 'Nueva', materialId: material.id, kind: 'LINK', url: 'https://example.test' });
    const managerView = await service.get(teacher.id, 'course'); expect(managerView.units[0]!.sessions[0]!.materials[0]!.versions[0]!.storageKey).toBeNull();
    expect((await service.download(teacher.id, 'course', material.id, original.id)).bytes).toEqual(new Uint8Array([1, 2]));
    await service.transition(teacher.id, 'course', course.data.revision, 'SUBMITTED', ''); await service.transition(designer.id, 'course', course.data.revision, 'APPROVED', '');
    const view = await service.get(student.id, 'course'); expect(view.units[0]!.sessions[0]!.materials[0]!.versions).toHaveLength(1); expect(view.reviews).toHaveLength(0);
    await expect(service.download(student.id, 'course', material.id, original.id)).rejects.toThrow('NOT_FOUND');
    await expect(service.download(teacher.id, 'missing', material.id, original.id)).rejects.toThrow('NOT_FOUND');
  });
  it('persists idempotent completion and reports actual activity to managers', async () => {
    const { material } = await prepare(); await service.transition(teacher.id, 'course', course.data.revision, 'SUBMITTED', ''); await service.transition(designer.id, 'course', course.data.revision, 'APPROVED', '');
    expect((await service.complete(student.id, 'course', material.id)).progress?.percentage).toBe(100); await service.complete(student.id, 'course', material.id); expect(completed.size).toBe(1);
    expect(await service.activity(teacher.id, 'course')).toMatchObject([{ percentage: 100 }]); await expect(service.complete(teacher.id, 'course', material.id)).rejects.toThrow('FORBIDDEN');
    await expect(service.complete(student.id, 'missing', material.id)).rejects.toThrow('NOT_FOUND'); await expect(service.activity(student.id, 'course')).rejects.toThrow('FORBIDDEN');
    await expect(service.activity('admin', 'missing')).rejects.toThrow('NOT_FOUND');
    expect(await service.teachers('admin')).toHaveLength(1); await expect(service.teachers(student.id)).rejects.toThrow('FORBIDDEN');
  });
  it('cleans up a stored file on conflicts and rejects wrong-session material updates', async () => {
    const { unit, session, material } = await prepare(); await service.session(teacher.id, 'course', course.data.revision, unit.id, 'Otra', '');
    const other = unit.sessions[1]!;
    await expect(service.material(teacher.id, 'course', course.data.revision, other.id, { title: 'No', kind: 'FILE', materialId: material.id }, { bytes: new Uint8Array([1]), filename: 'a.pdf', mimeType: 'application/pdf' })).rejects.toThrow('NOT_FOUND');
    expect(storage.remove).toHaveBeenCalledWith('private-key');
    await expect(service.material(teacher.id, 'course', 0, session.id, { title: 'No', kind: 'FILE' }, { bytes: new Uint8Array([1]), filename: 'a.pdf', mimeType: 'application/pdf' })).rejects.toThrow('CONFLICT');
    await expect(service.material(teacher.id, 'course', course.data.revision, session.id, { title: 'No', kind: 'FILE' })).rejects.toThrow('FILE_REJECTED');
    await expect(service.material(teacher.id, 'course', course.data.revision, session.id, { title: 'No', kind: 'LINK' }, { bytes: new Uint8Array([1]), filename: 'a.pdf', mimeType: 'application/pdf' })).rejects.toThrow('FILE_REJECTED');
    await expect(service.material(teacher.id, 'missing', 0, session.id, { title: 'No', kind: 'LINK' })).rejects.toThrow('NOT_FOUND');
  });
});
