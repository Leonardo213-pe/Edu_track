export type CourseStatus = 'BORRADOR' | 'EN_REVISION' | 'PUBLICADO' | 'ARCHIVADO';
export type CourseRole = 'ADMIN' | 'TEACHER' | 'INSTRUCTIONAL_DESIGNER' | 'STUDENT';
export interface Actor { id: string; role: CourseRole }
export class CourseError extends Error {
  constructor(readonly code: 'INVALID_INPUT' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'INVALID_STATE' | 'INCOMPLETE_COURSE' | 'FILE_REJECTED') { super(code); }
}
export interface ContentVersion {
  id: string; number: number; kind: 'FILE' | 'LINK' | 'VIDEO'; filename: string | null; mimeType: string | null;
  storageKey: string | null; size: number | null; sha256: string | null; url: string | null; createdAt: string; authorId: string;
}
export interface Material { id: string; title: string; position: number; versions: ContentVersion[] }
export interface Session { id: string; title: string; description: string; durationMinutes: number; position: number; materials: Material[] }
export interface Unit { id: string; title: string; position: number; sessions: Session[] }
export type Decision = 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'REOPENED' | 'ARCHIVED';
export interface Review { id: string; decision: Decision; actorId: string; observations: string; revision: number; createdAt: string }
export interface CourseData {
  id: string; code: string; name: string; description: string; period: string; teacherId: string;
  syllabus: string; status: CourseStatus; revision: number; createdAt: string; units: Unit[]; reviews: Review[];
}
export type ChangeAction = 'COURSE_CREATED' | 'METADATA_EDITED' | 'SYLLABUS_EDITED' | 'TEACHER_ASSIGNED' | 'UNIT_ADDED' | 'UNIT_EDITED' |
  'UNIT_REMOVED' | 'SESSION_ADDED' | 'SESSION_EDITED' | 'SESSION_REMOVED' | 'MATERIAL_ADDED' | 'MATERIAL_VERSION_ADDED' |
  'MATERIAL_REMOVED' | 'STRUCTURE_REORDERED' | 'STATUS_CHANGED';
/** A relevant change waiting to be appended to the course history in the same transaction. */
export interface PendingChange { action: ChangeAction; actorId: string; detail: Record<string, unknown> }
export type DeepReadonly<T> = T extends (infer E)[] ? readonly DeepReadonly<E>[] : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;

export function text(value: string, max: number, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim()) || value.trim().length > max) throw new CourseError('INVALID_INPUT');
  return value.trim();
}
export function safeUrl(value: string): string {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
    return url.toString();
  } catch { throw new CourseError('INVALID_INPUT'); }
}
function minutes(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 1440) throw new CourseError('INVALID_INPUT');
  return value;
}

// State: each lifecycle phase decides its transitions, whether content is editable and whether students may see it.
interface CourseState {
  readonly status: CourseStatus;
  next(action: Decision): CourseStatus;
  allowsEditing(): boolean;
  visibleToStudents(): boolean;
}
class Draft implements CourseState {
  readonly status = 'BORRADOR';
  next(action: Decision): CourseStatus {
    if (action === 'SUBMITTED') return 'EN_REVISION';
    if (action === 'ARCHIVED') return 'ARCHIVADO';
    throw new CourseError('INVALID_STATE');
  }
  allowsEditing() { return true; }
  visibleToStudents() { return false; }
}
class InReview implements CourseState {
  readonly status = 'EN_REVISION';
  next(action: Decision): CourseStatus {
    if (action === 'APPROVED') return 'PUBLICADO';
    if (action === 'REJECTED') return 'BORRADOR';
    throw new CourseError('INVALID_STATE');
  }
  allowsEditing() { return false; }
  visibleToStudents() { return false; }
}
class Published implements CourseState {
  readonly status = 'PUBLICADO';
  next(action: Decision): CourseStatus {
    if (action === 'REOPENED') return 'BORRADOR';
    if (action === 'ARCHIVED') return 'ARCHIVADO';
    throw new CourseError('INVALID_STATE');
  }
  allowsEditing() { return false; }
  visibleToStudents() { return true; }
}
class Archived implements CourseState {
  readonly status = 'ARCHIVADO';
  next(): CourseStatus { throw new CourseError('INVALID_STATE'); }
  allowsEditing() { return false; }
  visibleToStudents() { return false; }
}
const states: Record<CourseStatus, CourseState> = { BORRADOR: new Draft(), EN_REVISION: new InReview(), PUBLICADO: new Published(), ARCHIVADO: new Archived() };

// Composite: courses, units and sessions group components; materials are leaves. All answer the same questions.
export interface AcademicComponent {
  count(completed: ReadonlySet<string>): { total: number; completed: number };
  durationMinutes(): number;
}
export class MaterialLeaf implements AcademicComponent {
  constructor(private readonly versionId: string) {}
  count(completed: ReadonlySet<string>) { return { total: 1, completed: completed.has(this.versionId) ? 1 : 0 }; }
  durationMinutes() { return 0; }
}
export class AcademicGroup implements AcademicComponent {
  constructor(private readonly children: AcademicComponent[], private readonly ownMinutes = 0) {}
  count(completed: ReadonlySet<string>) {
    return this.children.reduce((sum, child) => {
      const current = child.count(completed);
      return { total: sum.total + current.total, completed: sum.completed + current.completed };
    }, { total: 0, completed: 0 });
  }
  durationMinutes(): number { return this.children.reduce((sum, child) => sum + child.durationMinutes(), this.ownMinutes); }
}

export interface CourseEdit { code: string; name: string; description: string; period: string; teacherId: string; syllabus: string }

export class Course {
  private readonly state: CourseData;
  private pending: PendingChange[] = [];
  constructor(data: CourseData) {
    text(data.code, 40); text(data.name, 160); text(data.description, 5000); text(data.period, 40); text(data.teacherId, 36);
    if (!states[data.status] || !Number.isInteger(data.revision) || data.revision < 0) throw new CourseError('INVALID_INPUT');
    this.state = structuredClone(data);
  }
  static create(input: Pick<CourseData, 'id' | 'code' | 'name' | 'description' | 'period' | 'teacherId' | 'createdAt'>, actorId?: string): Course {
    const course = new Course({ ...input, code: text(input.code, 40).toUpperCase(), name: text(input.name, 160), description: text(input.description, 5000),
      period: text(input.period, 40), syllabus: '', status: 'BORRADOR', revision: 0, units: [], reviews: [] });
    if (actorId) course.record('COURSE_CREATED', actorId, { code: course.state.code, period: course.state.period, teacherId: course.state.teacherId });
    return course;
  }
  /** Read-only view; mutations only happen through the aggregate's behaviour. */
  get data(): DeepReadonly<CourseData> { return this.state; }
  snapshot(): CourseData { return structuredClone(this.state); }
  /** Increments the optimistic revision after a successful persisted change. */
  advanceRevision(): void { this.state.revision++; }
  takeChanges(): PendingChange[] { const changes = this.pending; this.pending = []; return changes; }
  private record(action: ChangeAction, actorId: string, detail: Record<string, unknown>): void { this.pending.push({ action, actorId, detail }); }
  private get lifecycle(): CourseState { return states[this.state.status]; }

  visibleToStudents(): boolean { return this.lifecycle.visibleToStudents(); }
  wasEverPublished(): boolean { return this.state.reviews.some(review => review.decision === 'APPROVED'); }
  manager(actor: Actor): void {
    if (actor.role !== 'ADMIN' && !(actor.role === 'TEACHER' && actor.id === this.state.teacherId)) throw new CourseError('FORBIDDEN');
  }
  editable(actor: Actor): void { this.manager(actor); if (!this.lifecycle.allowsEditing()) throw new CourseError('INVALID_STATE'); }

  edit(actor: Actor, input: CourseEdit): void {
    this.editable(actor);
    if (actor.role !== 'ADMIN' && input.teacherId !== this.state.teacherId) throw new CourseError('FORBIDDEN');
    const next = { code: text(input.code, 40).toUpperCase(), name: text(input.name, 160), description: text(input.description, 5000),
      period: text(input.period, 40), teacherId: text(input.teacherId, 36), syllabus: text(input.syllabus, 50000, true) };
    const changed = (['code', 'name', 'description', 'period'] as const).filter(key => next[key] !== this.state[key]);
    if (changed.length) this.record('METADATA_EDITED', actor.id, Object.fromEntries(changed.map(key => [key, { before: this.state[key], after: next[key] }])));
    if (next.teacherId !== this.state.teacherId) this.record('TEACHER_ASSIGNED', actor.id, { before: this.state.teacherId, after: next.teacherId });
    if (next.syllabus !== this.state.syllabus) this.record('SYLLABUS_EDITED', actor.id, { before: this.state.syllabus, after: next.syllabus });
    Object.assign(this.state, next);
  }

  private findUnit(id: string): Unit {
    const unit = this.state.units.find(item => item.id === id); if (!unit) throw new CourseError('NOT_FOUND'); return unit;
  }
  private findSession(id: string): Session {
    const session = this.state.units.flatMap(unit => unit.sessions).find(item => item.id === id); if (!session) throw new CourseError('NOT_FOUND'); return session;
  }
  private findMaterial(id: string): Material {
    const material = this.state.units.flatMap(unit => unit.sessions).flatMap(session => session.materials).find(item => item.id === id);
    if (!material) throw new CourseError('NOT_FOUND'); return material;
  }
  unit(id: string): DeepReadonly<Unit> { return this.findUnit(id); }
  session(id: string): DeepReadonly<Session> { return this.findSession(id); }
  material(id: string): DeepReadonly<Material> { return this.findMaterial(id); }
  currentVersion(materialId: string): DeepReadonly<ContentVersion> {
    const versions = this.findMaterial(materialId).versions; return versions[versions.length - 1]!;
  }

  addUnit(actor: Actor, id: string, title: string): void {
    this.editable(actor);
    this.state.units.push({ id, title: text(title, 160), position: this.state.units.length, sessions: [] });
    this.record('UNIT_ADDED', actor.id, { unitId: id, title: title.trim() });
  }
  editUnit(actor: Actor, id: string, title: string): void {
    this.editable(actor); const unit = this.findUnit(id); const before = unit.title; unit.title = text(title, 160);
    if (before !== unit.title) this.record('UNIT_EDITED', actor.id, { unitId: id, before, after: unit.title });
  }
  addSession(actor: Actor, unitId: string, id: string, title: string, description: string, durationMinutes = 0): void {
    this.editable(actor); const unit = this.findUnit(unitId);
    unit.sessions.push({ id, title: text(title, 160), description: text(description, 5000, true), durationMinutes: minutes(durationMinutes), position: unit.sessions.length, materials: [] });
    this.record('SESSION_ADDED', actor.id, { unitId, sessionId: id, title: title.trim() });
  }
  editSession(actor: Actor, id: string, title: string, description: string, durationMinutes?: number): void {
    this.editable(actor); const session = this.findSession(id);
    const next = { title: text(title, 160), description: text(description, 5000, true), durationMinutes: durationMinutes === undefined ? session.durationMinutes : minutes(durationMinutes) };
    const changed = (['title', 'description', 'durationMinutes'] as const).filter(key => next[key] !== session[key]);
    if (changed.length) this.record('SESSION_EDITED', actor.id, { sessionId: id, ...Object.fromEntries(changed.map(key => [key, { before: session[key], after: next[key] }])) });
    Object.assign(session, next);
  }
  reorder(actor: Actor, type: 'units' | 'sessions' | 'materials', parentId: string, ids: string[]): void {
    this.editable(actor);
    const items: { id: string; position: number }[] = type === 'units' ? this.state.units : type === 'sessions' ? this.findUnit(parentId).sessions : this.findSession(parentId).materials;
    if (ids.length !== items.length || new Set(ids).size !== ids.length || items.some(item => !ids.includes(item.id))) throw new CourseError('INVALID_INPUT');
    items.forEach(item => { item.position = ids.indexOf(item.id); }); items.sort((a, b) => a.position - b.position);
    this.record('STRUCTURE_REORDERED', actor.id, { type, parentId, ids });
  }
  addVersion(actor: Actor, sessionId: string, materialId: string, title: string, version: ContentVersion): void {
    this.editable(actor); const session = this.findSession(sessionId);
    let material = session.materials.find(item => item.id === materialId); const created = !material;
    if (!material) { material = { id: materialId, title: text(title, 160), position: session.materials.length, versions: [] }; session.materials.push(material); }
    if (version.number !== material.versions.length + 1) throw new CourseError('CONFLICT');
    if (version.kind !== 'FILE') version.url = safeUrl(version.url ?? '');
    material.title = text(title, 160); material.versions.push(version);
    this.record(created ? 'MATERIAL_ADDED' : 'MATERIAL_VERSION_ADDED', actor.id, { sessionId, materialId, versionId: version.id, number: version.number, kind: version.kind, title: material.title });
  }

  // Removal is only allowed while the course has never been published, so no student history or approved content is lost.
  private removable(actor: Actor): void { this.editable(actor); if (this.wasEverPublished()) throw new CourseError('INVALID_STATE'); }
  private static storageKeys(materials: Material[]): string[] {
    return materials.flatMap(material => material.versions.map(version => version.storageKey).filter((key): key is string => !!key));
  }
  removeUnit(actor: Actor, id: string): string[] {
    this.removable(actor); const unit = this.findUnit(id);
    this.state.units = this.state.units.filter(item => item.id !== id); this.state.units.forEach((item, index) => { item.position = index; });
    this.record('UNIT_REMOVED', actor.id, { unitId: id, title: unit.title });
    return Course.storageKeys(unit.sessions.flatMap(session => session.materials));
  }
  removeSession(actor: Actor, id: string): string[] {
    this.removable(actor); const session = this.findSession(id); const unit = this.state.units.find(item => item.sessions.includes(session))!;
    unit.sessions = unit.sessions.filter(item => item.id !== id); unit.sessions.forEach((item, index) => { item.position = index; });
    this.record('SESSION_REMOVED', actor.id, { unitId: unit.id, sessionId: id, title: session.title });
    return Course.storageKeys(session.materials);
  }
  removeMaterial(actor: Actor, id: string): string[] {
    this.removable(actor); const material = this.findMaterial(id);
    const session = this.state.units.flatMap(unit => unit.sessions).find(item => item.materials.includes(material))!;
    session.materials = session.materials.filter(item => item.id !== id); session.materials.forEach((item, index) => { item.position = index; });
    this.record('MATERIAL_REMOVED', actor.id, { sessionId: session.id, materialId: id, title: material.title });
    return Course.storageKeys([material]);
  }

  transition(actor: Actor, decision: Decision, observations: string, id: string, now: string): void {
    if (decision === 'APPROVED' || decision === 'REJECTED') {
      if (actor.role !== 'INSTRUCTIONAL_DESIGNER') throw new CourseError('FORBIDDEN');
      if (actor.id === this.state.teacherId) throw new CourseError('FORBIDDEN');
      if (decision === 'REJECTED') text(observations, 5000);
    } else this.manager(actor);
    if (decision === 'SUBMITTED' && (!this.state.syllabus.trim() || !this.state.units.length || this.state.units.some(unit => !unit.sessions.length) ||
      this.state.units.some(unit => unit.sessions.some(session => !session.materials.length)))) throw new CourseError('INCOMPLETE_COURSE');
    const before = this.state.status; const next = this.lifecycle.next(decision);
    this.state.reviews.push({ id, actorId: actor.id, decision, observations: text(observations, 5000, true), revision: this.state.revision, createdAt: now });
    this.state.status = next;
    this.record('STATUS_CHANGED', actor.id, { decision, before, after: next });
  }

  /** Composite tree built from the current structure: course → units → sessions → current material versions. */
  private structure(): AcademicComponent {
    return new AcademicGroup(this.state.units.map(unit => new AcademicGroup(unit.sessions.map(session => new AcademicGroup(
      session.materials.map(material => new MaterialLeaf(material.versions[material.versions.length - 1]!.id)), session.durationMinutes)))));
  }
  progress(completed: ReadonlySet<string>) {
    const count = this.structure().count(completed);
    return { ...count, percentage: count.total ? Math.round(10000 * count.completed / count.total) / 100 : 0 };
  }
  durationMinutes(): number { return this.structure().durationMinutes(); }
}
