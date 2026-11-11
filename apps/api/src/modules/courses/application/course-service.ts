import { Course, CourseError, type Actor, type CourseEdit, type Decision } from '../domain/course';
import type { CourseCatalog } from '../public';
import type { CourseEnrollment, CourseIdentity, CourseRepository, CourseRuntime, CourseStorage, CourseView, FileInput, StoredFile } from './ports';

export interface CourseInput { code: string; name: string; description: string; period: string; teacherId: string }
export interface MaterialInput { title: string; materialId?: string; url?: string; kind: 'FILE' | 'LINK' | 'VIDEO' }
export type StructureTarget = 'units' | 'sessions' | 'materials';

export class CourseService implements CourseCatalog {
  constructor(private readonly repo: CourseRepository, private readonly identity: CourseIdentity, private readonly enrollments: CourseEnrollment,
    private readonly storage: CourseStorage, private readonly clock: CourseRuntime) {}

  private async actor(id: string): Promise<Actor> {
    const actor = await this.identity.find(id); if (!actor) throw new CourseError('FORBIDDEN'); return actor;
  }
  private async readable(actor: Actor, course: Course): Promise<void> {
    if (actor.role === 'ADMIN' || actor.role === 'INSTRUCTIONAL_DESIGNER') return;
    if (actor.role === 'TEACHER' && course.data.teacherId === actor.id) return;
    if (actor.role === 'STUDENT' && course.visibleToStudents() && await this.enrollments.has(actor.id, course.data.id)) return;
    throw new CourseError('FORBIDDEN');
  }
  private async load(id: string): Promise<Course> {
    const course = await this.repo.find(id); if (!course) throw new CourseError('NOT_FOUND'); return course;
  }
  private staff(actor: Actor, course: Course): void {
    if (actor.role === 'ADMIN' || actor.role === 'INSTRUCTIONAL_DESIGNER') return;
    course.manager(actor);
  }

  async findPublished(id: string) {
    const course = await this.repo.find(id);
    return course?.visibleToStudents() ? { id, code: course.data.code, name: course.data.name, teacherId: course.data.teacherId } : null;
  }

  async describe(id: string) {
    const course = await this.repo.find(id);
    return course ? { id, code: course.data.code, name: course.data.name, teacherId: course.data.teacherId, status: course.data.status } : null;
  }

  async units(id: string) {
    const course = await this.repo.find(id); return course ? course.data.units.map(unit => ({ id: unit.id, title: unit.title })) : [];
  }
  async progressOf(id: string) {
    const course = await this.repo.find(id); if (!course) return [];
    return (await this.repo.activity(id)).map(row => ({ studentId: row.userId, percentage: course.progress(new Set(row.versions)).percentage }));
  }

  async list(userId: string) {
    const actor = await this.actor(userId);
    let courses: Course[];
    if (actor.role === 'STUDENT') {
      const ids = await this.enrollments.courses(userId);
      courses = ids.length ? await this.repo.list({ ids, statuses: ['PUBLICADO'] }) : [];
    } else courses = await this.repo.list(actor.role === 'TEACHER' ? { teacherId: actor.id } : {});
    const names = await this.identity.names([...new Set(courses.map(course => course.data.teacherId))]);
    const visible = [];
    for (const course of courses) {
      const { units, reviews, syllabus, ...summary } = course.snapshot();
      visible.push({ ...summary, teacherName: names.get(summary.teacherId) ?? summary.teacherId, durationMinutes: course.durationMinutes(),
        unitCount: units.length, sessionCount: units.reduce((sum, unit) => sum + unit.sessions.length, 0),
        ...(actor.role === 'STUDENT' ? { progress: course.progress(new Set(await this.repo.completed(userId, course.data.id))) } : {}) });
    }
    return visible;
  }
  async teachers(userId: string) {
    if ((await this.actor(userId)).role !== 'ADMIN') throw new CourseError('FORBIDDEN');
    return this.identity.teachers();
  }
  async activity(userId: string, id: string) {
    const actor = await this.actor(userId); const course = await this.load(id); course.manager(actor);
    const rows = await this.repo.activity(id); const names = await this.identity.names(rows.map(row => row.userId));
    return rows.map(row => ({ userId: row.userId, displayName: names.get(row.userId) ?? row.userId, ...course.progress(new Set(row.versions)) }));
  }
  async history(userId: string, id: string) {
    const actor = await this.actor(userId); const course = await this.load(id); this.staff(actor, course);
    const entries = await this.repo.history(id); const names = await this.identity.names([...new Set(entries.map(entry => entry.actorId))]);
    return entries.map(entry => ({ ...entry, actorName: names.get(entry.actorId) ?? entry.actorId }));
  }
  async get(userId: string, id: string): Promise<CourseView> {
    const actor = await this.actor(userId); const course = await this.load(id); await this.readable(actor, course);
    const names = await this.identity.names([course.data.teacherId]); const student = actor.role === 'STUDENT';
    const view: CourseView = { ...course.snapshot(), teacherName: names.get(course.data.teacherId) ?? course.data.teacherId, durationMinutes: course.durationMinutes() };
    for (const unit of view.units) for (const session of unit.sessions) for (const material of session.materials) {
      if (student) material.versions = material.versions.slice(-1);
      for (const version of material.versions) version.storageKey = null;
    }
    if (!student) return { ...view, removable: view.status === 'BORRADOR' && !course.wasEverPublished() };
    const completedVersions = await this.repo.completed(userId, id);
    return { ...view, reviews: [], progress: course.progress(new Set(completedVersions)), completedVersions };
  }
  async create(userId: string, input: CourseInput) {
    const actor = await this.actor(userId); if (!['ADMIN', 'TEACHER'].includes(actor.role)) throw new CourseError('FORBIDDEN');
    if (actor.role === 'TEACHER' && input.teacherId !== actor.id) throw new CourseError('FORBIDDEN');
    if ((await this.identity.find(input.teacherId))?.role !== 'TEACHER') throw new CourseError('INVALID_INPUT');
    const course = Course.create({ ...input, id: this.clock.id(), createdAt: this.clock.now() }, actor.id);
    await this.repo.create(course); return this.get(userId, course.data.id);
  }
  private async change(userId: string, id: string, revision: number, work: (course: Course, actor: Actor) => Promise<void>) {
    if (!Number.isInteger(revision) || revision < 0) throw new CourseError('INVALID_INPUT');
    await this.repo.mutate(id, revision, async course => { const actor = await this.actor(userId); await work(course, actor); });
    return this.get(userId, id);
  }
  edit(userId: string, id: string, revision: number, input: CourseEdit) {
    return this.change(userId, id, revision, async (course, actor) => {
      if ((await this.identity.find(input.teacherId))?.role !== 'TEACHER') throw new CourseError('INVALID_INPUT');
      course.edit(actor, input);
    });
  }
  unit(userId: string, id: string, revision: number, title: string, unitId?: string) {
    return this.change(userId, id, revision, async (course, actor) => unitId ? course.editUnit(actor, unitId, title) : course.addUnit(actor, this.clock.id(), title));
  }
  session(userId: string, id: string, revision: number, unitId: string, input: { title: string; description: string; durationMinutes?: number }, sessionId?: string) {
    return this.change(userId, id, revision, async (course, actor) => sessionId
      ? course.editSession(actor, sessionId, input.title, input.description, input.durationMinutes)
      : course.addSession(actor, unitId, this.clock.id(), input.title, input.description, input.durationMinutes ?? 0));
  }
  reorder(userId: string, id: string, revision: number, type: StructureTarget, parentId: string, ids: string[]) {
    return this.change(userId, id, revision, async (course, actor) => course.reorder(actor, type, parentId, ids));
  }
  transition(userId: string, id: string, revision: number, decision: Decision, observations: string) {
    return this.change(userId, id, revision, async (course, actor) => course.transition(actor, decision, observations, this.clock.id(), this.clock.now()));
  }
  async remove(userId: string, id: string, revision: number, type: StructureTarget, targetId: string) {
    let keys: string[] = [];
    const view = await this.change(userId, id, revision, async (course, actor) => {
      keys = type === 'units' ? course.removeUnit(actor, targetId) : type === 'sessions' ? course.removeSession(actor, targetId) : course.removeMaterial(actor, targetId);
    });
    // Metadata is already committed; failing to delete a byte blob only leaves an orphan for later reconciliation.
    for (const key of keys) await this.storage.remove(key).catch(() => undefined);
    return view;
  }
  /** Checked before the multipart body is read, so unauthorized users cannot make the server buffer uploads. */
  async authorizeUpload(userId: string, id: string, sessionId: string): Promise<void> {
    const actor = await this.actor(userId); const course = await this.load(id); course.editable(actor); course.session(sessionId);
  }
  async material(userId: string, id: string, revision: number, sessionId: string, input: MaterialInput, file?: FileInput) {
    await this.authorizeUpload(userId, id, sessionId);
    if (input.kind !== 'FILE' && file) throw new CourseError('FILE_REJECTED');
    let stored: StoredFile | undefined;
    if (input.kind === 'FILE') { if (!file) throw new CourseError('FILE_REJECTED'); stored = await this.storage.put(file); }
    try {
      return await this.change(userId, id, revision, async (course, current) => {
        const materialId = input.materialId ?? this.clock.id();
        const existing = input.materialId ? course.material(materialId) : null;
        if (existing && !course.session(sessionId).materials.some(material => material.id === materialId)) throw new CourseError('NOT_FOUND');
        course.addVersion(current, sessionId, materialId, input.title, { id: this.clock.id(), number: (existing?.versions.length ?? 0) + 1, kind: input.kind,
          filename: stored?.filename ?? null, mimeType: stored?.mimeType ?? null, size: stored?.size ?? null, storageKey: stored?.key ?? null, sha256: stored?.sha256 ?? null,
          url: input.kind === 'FILE' ? null : input.url ?? null, authorId: current.id, createdAt: this.clock.now() });
      });
    } catch (error) { if (stored) await this.storage.remove(stored.key); throw error; }
  }
  async download(userId: string, id: string, materialId: string, versionId: string) {
    const actor = await this.actor(userId); const course = await this.load(id); await this.readable(actor, course);
    const material = course.material(materialId); const version = material.versions.find(item => item.id === versionId);
    if (!version || !version.storageKey || (actor.role === 'STUDENT' && version.id !== course.currentVersion(materialId).id)) throw new CourseError('NOT_FOUND');
    return { bytes: await this.storage.read(version.storageKey), filename: version.filename!, mimeType: version.mimeType! };
  }
  async complete(userId: string, id: string, materialId: string) {
    const actor = await this.actor(userId); if (actor.role !== 'STUDENT') throw new CourseError('FORBIDDEN');
    const course = await this.load(id); await this.readable(actor, course);
    // The repository re-checks publication and the current version under the same per-course lock used by editing.
    await this.repo.complete(userId, id, materialId, course.currentVersion(materialId).id);
    return this.get(userId, id);
  }
}
