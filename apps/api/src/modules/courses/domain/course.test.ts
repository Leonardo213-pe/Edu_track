import { describe, expect, it } from 'vitest';
import { AcademicGroup, Course, CourseError, MaterialLeaf, safeUrl, text, type Actor, type ContentVersion } from './course';
const teacher: Actor = { id: 'teacher', role: 'TEACHER' }, designer: Actor = { id: 'designer', role: 'INSTRUCTIONAL_DESIGNER' };
export function example() { return Course.create({ id: 'course', code: ' CS-1 ', name: 'Curso', description: 'Descripción', period: '2026-II', teacherId: 'teacher', createdAt: '2026-11-11T00:00:00Z' }); }
function syllabus(course: Course) { course.edit(teacher, { ...course.data, syllabus: 'Sílabo' }); }
export function version(id = 'v1', number = 1): ContentVersion { return { id, number, kind: 'LINK', url: 'https://example.test/resource', filename: null, mimeType: null, size: null, sha256: null, storageKey: null, authorId: teacher.id, createdAt: '2026-11-11T00:00:00Z' }; }
export function ready() { const course = example(); syllabus(course); course.addUnit(teacher, 'u1', 'Unidad'); course.addSession(teacher, 'u1', 's1', 'Sesión', 'Detalle'); course.addVersion(teacher, 's1', 'm1', 'Material', version()); return course; }
describe('course aggregate, State and Composite', () => {
  it('creates a normalized draft and validates required data', () => {
    expect(example().data).toMatchObject({ code: 'CS-1', status: 'BORRADOR', revision: 0 });
    expect(() => new Course({ ...example().data, name: '' })).toThrow('INVALID_INPUT');
    expect(() => new Course({ ...example().data, status: 'INVALID' as 'BORRADOR' })).toThrow('INVALID_INPUT');
    expect(() => new Course({ ...example().data, revision: -1 })).toThrow('INVALID_INPUT');
  });
  it.each(['', 'x'.repeat(41)])('rejects invalid course codes', code => expect(() => Course.create({ ...example().data, code })).toThrow('INVALID_INPUT'));
  it('edits metadata, units and sessions only as the assigned teacher or administrator', () => {
    const course = ready(); course.edit(teacher, { ...course.data, name: 'Nuevo' }); course.editUnit(teacher, 'u1', 'Unidad actualizada'); course.editSession(teacher, 's1', 'Sesión actualizada', '');
    expect(course.data.name).toBe('Nuevo'); expect(course.unit('u1').title).toContain('actualizada'); expect(course.session('s1').description).toBe('');
    expect(() => course.edit({ id: 'other', role: 'TEACHER' }, { ...course.data })).toThrow('FORBIDDEN');
    expect(() => course.edit(teacher, { ...course.data, teacherId: 'other' })).toThrow('FORBIDDEN');
    course.edit({ id: 'admin', role: 'ADMIN' }, { ...course.data, teacherId: 'other' }); expect(course.data.teacherId).toBe('other');
  });
  it('reorders exact permutations and refuses duplicates, omissions and foreign IDs', () => {
    const course = ready(); course.addUnit(teacher, 'u2', 'Segunda'); course.reorder(teacher, 'units', course.data.id, ['u2', 'u1']); expect(course.data.units.map(unit => unit.position)).toEqual([0, 1]);
    course.addSession(teacher, 'u1', 's2', 'Segunda sesión', ''); course.reorder(teacher, 'sessions', 'u1', ['s2', 's1']);
    course.addVersion(teacher, 's1', 'm2', 'Segundo', version('v2')); course.reorder(teacher, 'materials', 's1', ['m2', 'm1']);
    for (const ids of [['u1'], ['u1', 'u1'], ['u1', 'foreign']]) expect(() => course.reorder(teacher, 'units', '', ids)).toThrow('INVALID_INPUT');
    for (const find of [() => course.unit('missing'), () => course.session('missing'), () => course.material('missing')]) expect(find).toThrow('NOT_FOUND');
  });
  it('retains earlier versions and verifies consecutive version numbers and URLs', () => {
    const course = ready(); course.addVersion(teacher, 's1', 'm1', 'Material actualizado', version('v2', 2)); expect(course.material('m1').versions.map(version => version.id)).toEqual(['v1', 'v2']);
    expect(() => course.addVersion(teacher, 's1', 'm1', 'Material', version('bad', 8))).toThrow('CONFLICT');
    for (const url of ['javascript:alert(1)', 'ftp://example.test', 'https://user:pass@example.test', 'invalid']) expect(() => safeUrl(url)).toThrow('INVALID_INPUT');
    expect(text(' ', 10, true)).toBe(''); expect(() => text(' ', 10)).toThrow('INVALID_INPUT');
  });
  it('applies the full review, rejection, resubmission and publication workflow', () => {
    const course = ready(); course.transition(teacher, 'SUBMITTED', '', 'r1', '2026-11-11'); expect(course.data.status).toBe('EN_REVISION');
    expect(() => course.transition(teacher, 'APPROVED', '', 'bad', '')).toThrow('FORBIDDEN');
    expect(() => course.transition(designer, 'REJECTED', '', 'bad', '')).toThrow('INVALID_INPUT');
    course.transition(designer, 'REJECTED', 'Mejorar el sílabo', 'r2', '2026-11-11'); expect(course.data.status).toBe('BORRADOR'); expect(course.data.reviews[1]?.observations).toContain('sílabo');
    course.transition(teacher, 'SUBMITTED', '', 'r3', ''); course.transition(designer, 'APPROVED', 'Conforme', 'r4', ''); expect(course.data.status).toBe('PUBLICADO');
    expect(() => course.addUnit(teacher, 'u2', 'No revisada')).toThrow('INVALID_STATE');
    course.transition(teacher, 'REOPENED', 'Actualizar', 'r5', ''); expect(course.data.status).toBe('BORRADOR');
    course.transition(teacher, 'ARCHIVED', '', 'r6', ''); expect(() => course.transition(teacher, 'REOPENED', '', '', '')).toThrow('INVALID_STATE');
  });
  it('forbids publishing directly, editing in review, self-approval and invalid state transitions', () => {
    const course = ready(); expect(() => course.transition(designer, 'APPROVED', '', '', '')).toThrow('INVALID_STATE');
    expect(() => course.transition(teacher, 'REOPENED', '', '', '')).toThrow('INVALID_STATE');
    course.transition(teacher, 'SUBMITTED', '', '', ''); expect(() => course.editable(teacher)).toThrow('INVALID_STATE');
    expect(() => course.transition({ id: 'teacher', role: 'INSTRUCTIONAL_DESIGNER' }, 'APPROVED', '', '', '')).toThrow('FORBIDDEN');
    expect(() => course.transition(teacher, 'ARCHIVED', '', '', '')).toThrow('INVALID_STATE');
    course.transition(designer, 'APPROVED', '', '', ''); expect(() => course.transition(teacher, 'SUBMITTED', '', '', '')).toThrow('INVALID_STATE');
    course.transition(teacher, 'ARCHIVED', '', '', ''); expect(() => course.editable(teacher)).toThrow('INVALID_STATE');
  });
  it('requires a syllabus and complete teaching structure for submission', () => {
    const course = example(); expect(() => course.transition(teacher, 'SUBMITTED', '', '', '')).toThrow('INCOMPLETE_COURSE');
    syllabus(course); course.addUnit(teacher, 'u1', 'Unidad'); expect(() => course.transition(teacher, 'SUBMITTED', '', '', '')).toThrow('INCOMPLETE_COURSE');
    course.addSession(teacher, 'u1', 's1', 'Sesión', ''); expect(() => course.transition(teacher, 'SUBMITTED', '', '', '')).toThrow('INCOMPLETE_COURSE');
  });
  it('calculates weighted-by-leaf progress on current versions, including empty courses', () => {
    const course = ready(); course.addVersion(teacher, 's1', 'm2', 'Segundo', version('v2')); expect(course.progress(new Set(['v1'])).percentage).toBe(50);
    course.addVersion(teacher, 's1', 'm1', 'Nueva', version('v3', 2)); expect(course.progress(new Set(['v1']))).toMatchObject({ percentage: 0, total: 2 });
    expect(course.progress(new Set(['v2', 'v3'])).percentage).toBe(100); expect(example().progress(new Set()).percentage).toBe(0);
    expect(new AcademicGroup([new MaterialLeaf('x')]).count(new Set(['x']))).toEqual({ total: 1, completed: 1 });
  });
  it('lets each lifecycle state decide editing and student visibility', () => {
    const course = ready(); expect(course.visibleToStudents()).toBe(false); expect(() => course.editable(teacher)).not.toThrow();
    course.transition(teacher, 'SUBMITTED', '', 'r1', ''); expect(course.visibleToStudents()).toBe(false); expect(() => course.editable(teacher)).toThrow('INVALID_STATE');
    course.transition(designer, 'APPROVED', '', 'r2', ''); expect(course.visibleToStudents()).toBe(true); expect(() => course.editable(teacher)).toThrow('INVALID_STATE');
    course.transition(teacher, 'ARCHIVED', '', 'r3', ''); expect(course.visibleToStudents()).toBe(false);
  });
  it('sums session durations through the Composite and validates the range', () => {
    const course = ready(); course.editSession(teacher, 's1', 'Sesión', 'Detalle', 90); course.addSession(teacher, 'u1', 's2', 'Taller', '', 45);
    course.addUnit(teacher, 'u2', 'Segunda'); course.addSession(teacher, 'u2', 's3', 'Cierre', '', 30);
    expect(course.durationMinutes()).toBe(165); expect(course.session('s2').durationMinutes).toBe(45);
    course.editSession(teacher, 's2', 'Taller', ''); expect(course.session('s2').durationMinutes).toBe(45);
    for (const bad of [-1, 1441, 1.5]) expect(() => course.addSession(teacher, 'u1', 'bad', 'Mala', '', bad)).toThrow('INVALID_INPUT');
    expect(new AcademicGroup([new AcademicGroup([new MaterialLeaf('x')], 20)], 10).durationMinutes()).toBe(30);
  });
  it('records relevant changes with before/after values and hands them over once', () => {
    const course = Course.create({ ...example().data }, 'teacher'); expect(course.takeChanges().map(change => change.action)).toEqual(['COURSE_CREATED']);
    course.edit(teacher, { ...course.data, name: 'Curso nuevo', syllabus: 'Resultados' }); course.addUnit(teacher, 'u1', 'Unidad');
    course.addSession(teacher, 'u1', 's1', 'Sesión', ''); course.addVersion(teacher, 's1', 'm1', 'Material', version());
    course.addVersion(teacher, 's1', 'm1', 'Material', version('v2', 2)); course.editUnit(teacher, 'u1', 'Unidad'); course.transition(teacher, 'SUBMITTED', '', 'r1', '');
    const changes = course.takeChanges();
    expect(changes.map(change => change.action)).toEqual(['METADATA_EDITED', 'SYLLABUS_EDITED', 'UNIT_ADDED', 'SESSION_ADDED', 'MATERIAL_ADDED', 'MATERIAL_VERSION_ADDED', 'STATUS_CHANGED']);
    expect(changes[0]!.detail).toEqual({ name: { before: 'Curso', after: 'Curso nuevo' } }); expect(changes[1]!.detail).toEqual({ before: '', after: 'Resultados' });
    expect(changes.at(-1)!.detail).toEqual({ decision: 'SUBMITTED', before: 'BORRADOR', after: 'EN_REVISION' }); expect(course.takeChanges()).toEqual([]);
    course.transition(designer, 'REJECTED', 'Revisar', 'r2', ''); course.edit({ id: 'admin', role: 'ADMIN' }, { ...course.data, teacherId: 'other' });
    expect(course.takeChanges().map(change => change.action)).toEqual(['STATUS_CHANGED', 'TEACHER_ASSIGNED']);
  });
  it('keeps state encapsulated: snapshots are copies and revisions only advance through the aggregate', () => {
    const course = ready(); const copy = course.snapshot(); copy.status = 'PUBLICADO'; copy.units[0]!.title = 'Alterada';
    expect(course.data.status).toBe('BORRADOR'); expect(course.unit('u1').title).toBe('Unidad');
    course.advanceRevision(); expect(course.data.revision).toBe(1); expect(course.currentVersion('m1').id).toBe('v1');
  });
  it('removes structure of never-published drafts, renumbers positions and returns stored files to delete', () => {
    const course = ready(); course.addVersion(teacher, 's1', 'm2', 'Archivo', { ...version('v2'), kind: 'FILE', url: null, storageKey: 'key-2', filename: 'a.pdf', mimeType: 'application/pdf', size: 1, sha256: 'x' });
    course.addSession(teacher, 'u1', 's2', 'Segunda', ''); course.addUnit(teacher, 'u2', 'Segunda unidad');
    expect(course.removeMaterial(teacher, 'm1')).toEqual([]); expect(course.session('s1').materials.map(item => [item.id, item.position])).toEqual([['m2', 0]]);
    expect(course.removeSession(teacher, 's1')).toEqual(['key-2']); expect(course.unit('u1').sessions.map(item => [item.id, item.position])).toEqual([['s2', 0]]);
    expect(course.removeUnit(teacher, 'u1')).toEqual([]); expect(course.data.units.map(item => [item.id, item.position])).toEqual([['u2', 0]]);
    expect(() => course.removeUnit({ id: 'other', role: 'TEACHER' }, 'u2')).toThrow('FORBIDDEN'); expect(() => course.removeUnit(teacher, 'missing')).toThrow('NOT_FOUND');
    expect(course.takeChanges().filter(change => change.action.endsWith('_REMOVED')).map(change => change.action)).toEqual(['MATERIAL_REMOVED', 'SESSION_REMOVED', 'UNIT_REMOVED']);
  });
  it('preserves the structure of courses that were already published, even after reopening', () => {
    const course = ready(); course.transition(teacher, 'SUBMITTED', '', 'r1', ''); course.transition(designer, 'APPROVED', '', 'r2', '');
    expect(() => course.removeMaterial(teacher, 'm1')).toThrow('INVALID_STATE');
    course.transition(teacher, 'REOPENED', 'Actualizar', 'r3', ''); expect(course.wasEverPublished()).toBe(true);
    for (const remove of [() => course.removeMaterial(teacher, 'm1'), () => course.removeSession(teacher, 's1'), () => course.removeUnit(teacher, 'u1')]) expect(remove).toThrow('INVALID_STATE');
    course.addUnit(teacher, 'u2', 'Nueva unidad permitida'); expect(course.data.units).toHaveLength(2);
  });
});
