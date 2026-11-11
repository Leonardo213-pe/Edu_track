import { Course, CourseError, type Actor, type CourseData, type Review } from '../domain/course';
import type { CourseCatalog } from '../public';
import type { CourseEnrollment, CourseIdentity, CourseRepository, CourseRuntime, CourseStorage, CourseView, FileInput } from './ports';
export class CourseService implements CourseCatalog {
  constructor(private readonly repo: CourseRepository, private readonly identity: CourseIdentity, private readonly enrollments: CourseEnrollment,
    private readonly storage: CourseStorage, private readonly clock: CourseRuntime) {}
  private async actor(id: string): Promise<Actor> { const actor = await this.identity.find(id); if (!actor) throw new CourseError('FORBIDDEN'); return actor; }
  private async readable(actor: Actor, course: Course): Promise<void> {
    if (actor.role === 'ADMIN' || actor.role === 'INSTRUCTIONAL_DESIGNER') return;
    if (actor.role === 'TEACHER' && course.data.teacherId === actor.id) return;
    if (actor.role === 'STUDENT' && course.data.status === 'PUBLICADO' && await this.enrollments.has(actor.id, course.data.id)) return;
    throw new CourseError('FORBIDDEN');
  }
  async findPublished(id: string) { const course = await this.repo.find(id); return course?.data.status === 'PUBLICADO' ? { id, code: course.data.code, name: course.data.name, teacherId: course.data.teacherId } : null; }
  async list(userId: string) {
    const actor = await this.actor(userId); const courses = await this.repo.list(); const visible = []; const teachers = await this.identity.teachers();
    for (const course of courses) { try { await this.readable(actor, course); } catch (error) { if (error instanceof CourseError && error.code === 'FORBIDDEN') continue; throw error; }
      const { units, reviews, syllabus, ...summary } = course.data;
      visible.push({ ...summary, teacherName: teachers.find(teacher => teacher.id === summary.teacherId)?.displayName ?? summary.teacherId, unitCount: units.length, sessionCount: units.reduce((sum, unit) => sum + unit.sessions.length, 0),
        ...(actor.role === 'STUDENT' ? { progress: course.progress(new Set(await this.repo.completed(userId, course.data.id))) } : {}) });
    }
    return visible;
  }
  async teachers(userId: string) { if ((await this.actor(userId)).role !== 'ADMIN') throw new CourseError('FORBIDDEN'); return this.identity.teachers(); }
  async activity(userId: string, id: string) {
    const actor = await this.actor(userId); const course = await this.repo.find(id); if (!course) throw new CourseError('NOT_FOUND'); course.manager(actor);
    return (await this.repo.activity(id)).map(row => ({ userId: row.userId, ...course.progress(new Set(row.versions)) }));
  }
  async get(userId: string, id: string): Promise<CourseView> {
    const actor = await this.actor(userId); const course = await this.repo.find(id); if (!course) throw new CourseError('NOT_FOUND'); await this.readable(actor, course);
    const view: CourseView = { ...structuredClone(course.data), teacherName: (await this.identity.teachers()).find(teacher => teacher.id === course.data.teacherId)?.displayName ?? course.data.teacherId };
    for (const unit of view.units) for (const session of unit.sessions) for (const material of session.materials) {
      if (actor.role === 'STUDENT') material.versions = material.versions.slice(-1);
      for (const version of material.versions) version.storageKey = null;
    }
    if (actor.role !== 'STUDENT') return view;
    view.reviews = []; const completedVersions = await this.repo.completed(userId, id);
    return { ...view, progress: course.progress(new Set(completedVersions)), completedVersions };
  }
  async create(userId: string, input: Pick<CourseData, 'code' | 'name' | 'description' | 'period' | 'teacherId'>) {
    const actor = await this.actor(userId); if (!['ADMIN', 'TEACHER'].includes(actor.role)) throw new CourseError('FORBIDDEN');
    if (actor.role === 'TEACHER' && input.teacherId !== actor.id) throw new CourseError('FORBIDDEN');
    if ((await this.identity.find(input.teacherId))?.role !== 'TEACHER') throw new CourseError('INVALID_INPUT');
    const course = Course.create({ ...input, id: this.clock.id(), createdAt: this.clock.now() }); await this.repo.create(course); return course.data;
  }
  private async change(userId: string, id: string, revision: number, work: (course: Course, actor: Actor) => Promise<void>) {
    if (!Number.isInteger(revision) || revision < 0) throw new CourseError('INVALID_INPUT');
    await this.repo.mutate(id, revision, async course => { const actor = await this.actor(userId); await work(course, actor); });
    return this.get(userId, id);
  }
  edit(userId: string, id: string, revision: number, input: Parameters<Course['edit']>[1]) {
    return this.change(userId, id, revision, async (course, actor) => {
      if ((await this.identity.find(input.teacherId))?.role !== 'TEACHER') throw new CourseError('INVALID_INPUT'); course.edit(actor, input);
    });
  }
  unit(userId: string, id: string, revision: number, title: string, unitId?: string) {
    return this.change(userId, id, revision, async (course, actor) => unitId ? course.editUnit(actor, unitId, title) : course.addUnit(actor, this.clock.id(), title));
  }
  session(userId: string, id: string, revision: number, unitId: string, title: string, description: string, sessionId?: string) {
    return this.change(userId, id, revision, async (course, actor) => sessionId ? course.editSession(actor, sessionId, title, description) : course.addSession(actor, unitId, this.clock.id(), title, description));
  }
  reorder(userId: string, id: string, revision: number, type: 'units' | 'sessions' | 'materials', parentId: string, ids: string[]) {
    return this.change(userId, id, revision, async (course, actor) => course.reorder(actor, type, parentId, ids));
  }
  transition(userId: string, id: string, revision: number, decision: Review['decision'], observations: string) {
    return this.change(userId, id, revision, async (course, actor) => course.transition(actor, decision, observations, this.clock.id(), this.clock.now()));
  }
  async material(userId: string, id: string, revision: number, sessionId: string, input: { title: string; materialId?: string; url?: string; kind: 'FILE' | 'LINK' | 'VIDEO' }, file?: FileInput) {
    // Authorize before storing bytes; repeat inside the per-course transaction to prevent state races.
    const actor = await this.actor(userId); const before = await this.repo.find(id); if (!before) throw new CourseError('NOT_FOUND'); before.editable(actor); before.session(sessionId);
    let stored: Awaited<ReturnType<CourseStorage['put']>> | undefined;
    if (input.kind !== 'FILE' && file) throw new CourseError('FILE_REJECTED');
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
    const actor = await this.actor(userId); const course = await this.repo.find(id); if (!course) throw new CourseError('NOT_FOUND'); await this.readable(actor, course);
    const material = course.material(materialId); const version = material.versions.find(version => version.id === versionId);
    if (!version || !version.storageKey || (actor.role === 'STUDENT' && version.id !== material.versions[material.versions.length - 1]?.id)) throw new CourseError('NOT_FOUND');
    return { bytes: await this.storage.read(version.storageKey), filename: version.filename!, mimeType: version.mimeType! };
  }
  async complete(userId: string, id: string, materialId: string) {
    const actor = await this.actor(userId); if (actor.role !== 'STUDENT') throw new CourseError('FORBIDDEN');
    // Same course lock used by publication/editing keeps completion consistent with the visible version.
    const course = await this.repo.find(id); if (!course) throw new CourseError('NOT_FOUND'); await this.readable(actor, course);
    const material = course.material(materialId); await this.repo.complete(userId, id, materialId, material.versions[material.versions.length - 1]!.id);
    return this.get(userId, id);
  }
}
