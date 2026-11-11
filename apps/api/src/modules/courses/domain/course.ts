export type CourseStatus = 'BORRADOR' | 'EN_REVISION' | 'PUBLICADO' | 'ARCHIVADO';
export type CourseRole = 'ADMIN' | 'TEACHER' | 'INSTRUCTIONAL_DESIGNER' | 'STUDENT';
export interface Actor { id: string; role: CourseRole }
export class CourseError extends Error {
  constructor(readonly code: 'INVALID_INPUT' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'INVALID_STATE' | 'INCOMPLETE_COURSE' | 'FILE_REJECTED') { super(code); }
}
export interface ContentVersion { id: string; number: number; kind: 'FILE' | 'LINK' | 'VIDEO'; filename: string | null; mimeType: string | null;
  storageKey: string | null; size: number | null; sha256: string | null; url: string | null; createdAt: string; authorId: string }
export interface Material { id: string; title: string; position: number; versions: ContentVersion[] }
export interface Session { id: string; title: string; description: string; position: number; materials: Material[] }
export interface Unit { id: string; title: string; position: number; sessions: Session[] }
export interface Review { id: string; decision: 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'REOPENED' | 'ARCHIVED'; actorId: string; observations: string; revision: number; createdAt: string }
export interface CourseData { id: string; code: string; name: string; description: string; period: string; teacherId: string;
  syllabus: string; status: CourseStatus; revision: number; createdAt: string; units: Unit[]; reviews: Review[] }
export function text(value: string, max: number, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim()) || value.trim().length > max) throw new CourseError('INVALID_INPUT');
  return value.trim();
}
export function safeUrl(value: string): string {
  try { const url = new URL(value); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error(); return url.toString(); }
  catch { throw new CourseError('INVALID_INPUT'); }
}
interface CourseState { readonly status: CourseStatus; next(action: Review['decision']): CourseStatus }
class Draft implements CourseState {
  readonly status = 'BORRADOR'; next(action: Review['decision']): CourseStatus {
    if (action === 'SUBMITTED') return 'EN_REVISION'; if (action === 'ARCHIVED') return 'ARCHIVADO'; throw new CourseError('INVALID_STATE');
  }
}
class InReview implements CourseState {
  readonly status = 'EN_REVISION'; next(action: Review['decision']): CourseStatus {
    if (action === 'APPROVED') return 'PUBLICADO'; if (action === 'REJECTED') return 'BORRADOR'; throw new CourseError('INVALID_STATE');
  }
}
class Published implements CourseState {
  readonly status = 'PUBLICADO'; next(action: Review['decision']): CourseStatus {
    if (action === 'REOPENED') return 'BORRADOR'; if (action === 'ARCHIVED') return 'ARCHIVADO'; throw new CourseError('INVALID_STATE');
  }
}
class Archived implements CourseState {
  readonly status = 'ARCHIVADO'; next(): CourseStatus { throw new CourseError('INVALID_STATE'); }
}
const states: Record<CourseStatus, CourseState> = { BORRADOR: new Draft(), EN_REVISION: new InReview(), PUBLICADO: new Published(), ARCHIVADO: new Archived() };

// Composite: each grouping and leaf implements the same counting operation.
export interface AcademicComponent { count(completed: ReadonlySet<string>): { total: number; completed: number } }
export class MaterialLeaf implements AcademicComponent {
  constructor(private readonly versionId: string) {}
  count(completed: ReadonlySet<string>) { return { total: 1, completed: completed.has(this.versionId) ? 1 : 0 }; }
}
export class AcademicGroup implements AcademicComponent {
  constructor(private readonly children: AcademicComponent[]) {}
  count(completed: ReadonlySet<string>) {
    return this.children.reduce((sum, child) => { const current = child.count(completed); return { total: sum.total + current.total, completed: sum.completed + current.completed }; }, { total: 0, completed: 0 });
  }
}
export class Course {
  constructor(readonly data: CourseData) {
    text(data.code, 40); text(data.name, 160); text(data.description, 5000); text(data.period, 40); text(data.teacherId, 36);
    if (!states[data.status] || !Number.isInteger(data.revision) || data.revision < 0) throw new CourseError('INVALID_INPUT');
  }
  static create(input: Pick<CourseData, 'id' | 'code' | 'name' | 'description' | 'period' | 'teacherId' | 'createdAt'>): Course {
    return new Course({ ...input, code: text(input.code, 40).toUpperCase(), name: text(input.name, 160), description: text(input.description, 5000), period: text(input.period, 40),
      syllabus: '', status: 'BORRADOR', revision: 0, units: [], reviews: [] });
  }
  manager(actor: Actor): void {
    if (actor.role !== 'ADMIN' && !(actor.role === 'TEACHER' && actor.id === this.data.teacherId)) throw new CourseError('FORBIDDEN');
  }
  editable(actor: Actor): void { this.manager(actor); if (this.data.status !== 'BORRADOR') throw new CourseError('INVALID_STATE'); }
  edit(actor: Actor, input: { code: string; name: string; description: string; period: string; teacherId: string; syllabus: string }): void {
    this.editable(actor);
    if (actor.role !== 'ADMIN' && input.teacherId !== this.data.teacherId) throw new CourseError('FORBIDDEN');
    Object.assign(this.data, { code: text(input.code, 40).toUpperCase(), name: text(input.name, 160), description: text(input.description, 5000),
      period: text(input.period, 40), teacherId: text(input.teacherId, 36), syllabus: text(input.syllabus, 50000, true) });
  }
  addUnit(actor: Actor, id: string, title: string): void { this.editable(actor); this.data.units.push({ id, title: text(title, 160), position: this.data.units.length, sessions: [] }); }
  editUnit(actor: Actor, id: string, title: string): void { this.editable(actor); this.unit(id).title = text(title, 160); }
  unit(id: string): Unit { const unit = this.data.units.find(unit => unit.id === id); if (!unit) throw new CourseError('NOT_FOUND'); return unit; }
  session(id: string): Session { const session = this.data.units.flatMap(unit => unit.sessions).find(session => session.id === id); if (!session) throw new CourseError('NOT_FOUND'); return session; }
  material(id: string): Material { const material = this.data.units.flatMap(unit => unit.sessions).flatMap(session => session.materials).find(material => material.id === id); if (!material) throw new CourseError('NOT_FOUND'); return material; }
  addSession(actor: Actor, unitId: string, id: string, title: string, description: string): void {
    this.editable(actor); const unit = this.unit(unitId); unit.sessions.push({ id, title: text(title, 160), description: text(description, 5000, true), position: unit.sessions.length, materials: [] });
  }
  editSession(actor: Actor, id: string, title: string, description: string): void { this.editable(actor); Object.assign(this.session(id), { title: text(title, 160), description: text(description, 5000, true) }); }
  reorder(actor: Actor, type: 'units' | 'sessions' | 'materials', parentId: string, ids: string[]): void {
    this.editable(actor); const items = type === 'units' ? this.data.units : type === 'sessions' ? this.unit(parentId).sessions : this.session(parentId).materials;
    if (ids.length !== items.length || new Set(ids).size !== ids.length || items.some(item => !ids.includes(item.id))) throw new CourseError('INVALID_INPUT');
    items.forEach(item => { item.position = ids.indexOf(item.id); }); items.sort((a, b) => a.position - b.position);
  }
  addVersion(actor: Actor, sessionId: string, materialId: string, title: string, version: ContentVersion): void {
    this.editable(actor); const session = this.session(sessionId); let material = session.materials.find(material => material.id === materialId);
    if (!material) { material = { id: materialId, title: text(title, 160), position: session.materials.length, versions: [] }; session.materials.push(material); }
    if (version.number !== material.versions.length + 1) throw new CourseError('CONFLICT');
    if (version.kind !== 'FILE') version.url = safeUrl(version.url ?? '');
    material.title = text(title, 160); material.versions.push(version);
  }
  transition(actor: Actor, decision: Review['decision'], observations: string, id: string, now: string): void {
    if (decision === 'APPROVED' || decision === 'REJECTED') {
      if (actor.role !== 'INSTRUCTIONAL_DESIGNER') throw new CourseError('FORBIDDEN');
      if (actor.id === this.data.teacherId) throw new CourseError('FORBIDDEN');
      if (decision === 'REJECTED') text(observations, 5000);
    } else this.manager(actor);
    if (decision === 'SUBMITTED' && (!this.data.syllabus.trim() || !this.data.units.length || this.data.units.some(unit => !unit.sessions.length) ||
      this.data.units.some(unit => unit.sessions.some(session => !session.materials.length)))) throw new CourseError('INCOMPLETE_COURSE');
    const next = states[this.data.status].next(decision);
    this.data.reviews.push({ id, actorId: actor.id, decision, observations: text(observations, 5000, true), revision: this.data.revision, createdAt: now }); this.data.status = next;
  }
  progress(completed: ReadonlySet<string>) {
    const root = new AcademicGroup(this.data.units.map(unit => new AcademicGroup(unit.sessions.map(session => new AcademicGroup(
      session.materials.map(material => new MaterialLeaf(material.versions[material.versions.length - 1]!.id)))))));
    const count = root.count(completed); return { ...count, percentage: count.total ? Math.round(10000 * count.completed / count.total) / 100 : 0 };
  }
}
