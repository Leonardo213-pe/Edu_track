import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Prisma } from './generated/client';
import { Course, CourseError, type ChangeAction, type CourseData, type PendingChange } from '../../domain/course';
import type { CourseFilter, CourseHistoryEntry, CourseRepository } from '../../application/ports';

const tree = { units: { orderBy: { position: 'asc' as const }, include: { sessions: { orderBy: { position: 'asc' as const }, include: {
  materials: { orderBy: { position: 'asc' as const }, include: { versions: { orderBy: { number: 'asc' as const } } } },
} } } }, reviews: { orderBy: { createdAt: 'asc' as const } } };
type Row = Prisma.CourseGetPayload<{ include: typeof tree }>;

export class PrismaCourseRepository implements CourseRepository {
  private readonly db: PrismaClient;
  constructor(url: string) { this.db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max: 10, connectionTimeoutMillis: 5000 }) }); }

  private map(row: Row): Course {
    return new Course({ ...row, createdAt: row.createdAt.toISOString(),
      units: row.units.map(({ courseId, ...unit }) => ({ ...unit, sessions: unit.sessions.map(({ unitId, ...session }) => ({ ...session,
        materials: session.materials.map(({ sessionId, ...material }) => ({ ...material, versions: material.versions.map(({ materialId, ...version }) => ({
          ...version, kind: version.kind as 'FILE' | 'LINK' | 'VIDEO', createdAt: version.createdAt.toISOString() })) })) })) })),
      reviews: row.reviews.map(({ courseId, ...review }) => ({ ...review, decision: review.decision as CourseData['reviews'][number]['decision'], createdAt: review.createdAt.toISOString() })) });
  }
  private translate(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new CourseError('CONFLICT');
    throw error;
  }
  private changeRows(courseId: string, revision: number, changes: PendingChange[]) {
    const now = Date.now();
    // Millisecond offsets keep the order of several changes produced by one operation.
    return changes.map((change, index) => ({ id: randomUUID(), courseId, revision, actorId: change.actorId, action: change.action,
      detail: change.detail as Prisma.InputJsonValue, createdAt: new Date(now + index) }));
  }

  async create(course: Course): Promise<void> {
    const { units, reviews, ...data } = course.snapshot(); const changes = course.takeChanges();
    try {
      await this.db.$transaction(async tx => {
        await tx.course.create({ data: { ...data, createdAt: new Date(data.createdAt) } });
        if (changes.length) await tx.courseChange.createMany({ data: this.changeRows(data.id, data.revision, changes) });
      });
    } catch (error) { this.translate(error); }
  }
  async find(id: string) { const row = await this.db.course.findUnique({ where: { id }, include: tree }); return row ? this.map(row) : null; }
  async list(filter: CourseFilter = {}) {
    const where: Prisma.CourseWhereInput = {
      ...(filter.teacherId ? { teacherId: filter.teacherId } : {}),
      ...(filter.ids ? { id: { in: filter.ids } } : {}),
      ...(filter.statuses ? { status: { in: filter.statuses } } : {}),
    };
    return (await this.db.course.findMany({ where, include: tree, orderBy: { createdAt: 'desc' } })).map(row => this.map(row));
  }
  async mutate(id: string, revision: number, work: (course: Course) => Promise<void>): Promise<Course> {
    try {
      return await this.db.$transaction(async tx => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 31))::text`;
        const row = await tx.course.findUnique({ where: { id }, include: tree }); if (!row) throw new CourseError('NOT_FOUND');
        if (row.revision !== revision) throw new CourseError('CONFLICT');
        const course = this.map(row); await work(course); course.advanceRevision();
        const { units, reviews, createdAt, ...scalar } = course.snapshot(); const changes = course.takeChanges();
        await tx.course.update({ where: { id }, data: scalar });
        // Structure removed by the aggregate (only possible for never-published drafts) is deleted before upserting the rest.
        const sessions = units.flatMap(unit => unit.sessions); const materials = sessions.flatMap(session => session.materials);
        await tx.courseMaterial.deleteMany({ where: { session: { unit: { courseId: id } }, id: { notIn: materials.map(item => item.id) } } });
        await tx.courseSession.deleteMany({ where: { unit: { courseId: id }, id: { notIn: sessions.map(item => item.id) } } });
        await tx.courseUnit.deleteMany({ where: { courseId: id, id: { notIn: units.map(item => item.id) } } });
        for (const unit of units) {
          const { sessions: unitSessions, ...unitData } = unit;
          await tx.courseUnit.upsert({ where: { id: unit.id }, create: { ...unitData, courseId: id }, update: { title: unit.title, position: unit.position } });
          for (const session of unitSessions) {
            const { materials: sessionMaterials, ...sessionData } = session;
            await tx.courseSession.upsert({ where: { id: session.id }, create: { ...sessionData, unitId: unit.id },
              update: { title: session.title, description: session.description, durationMinutes: session.durationMinutes, position: session.position } });
            for (const material of sessionMaterials) {
              const { versions, ...materialData } = material;
              await tx.courseMaterial.upsert({ where: { id: material.id }, create: { ...materialData, sessionId: session.id }, update: { title: material.title, position: material.position } });
              await tx.materialVersion.createMany({ data: versions.map(version => ({ ...version, createdAt: new Date(version.createdAt), materialId: material.id })), skipDuplicates: true });
            }
          }
        }
        await tx.courseReview.createMany({ data: reviews.map(review => ({ ...review, createdAt: new Date(review.createdAt), courseId: id })), skipDuplicates: true });
        if (changes.length) await tx.courseChange.createMany({ data: this.changeRows(id, scalar.revision, changes) });
        return course;
      }, { timeout: 20000 });
    } catch (error) { this.translate(error); }
  }
  async history(courseId: string): Promise<CourseHistoryEntry[]> {
    const rows = await this.db.courseChange.findMany({ where: { courseId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    return rows.map(row => ({ id: row.id, revision: row.revision, actorId: row.actorId, action: row.action as ChangeAction,
      detail: row.detail as Record<string, unknown>, createdAt: row.createdAt.toISOString() }));
  }
  async completed(userId: string, courseId: string): Promise<string[]> {
    return (await this.db.contentCompletion.findMany({ where: { userId, courseId }, select: { versionId: true } })).map(row => row.versionId);
  }
  async activity(courseId: string) {
    const records = await this.db.contentCompletion.findMany({ where: { courseId }, select: { userId: true, versionId: true } });
    const groups = new Map<string, string[]>();
    for (const row of records) { const list = groups.get(row.userId) ?? []; list.push(row.versionId); groups.set(row.userId, list); }
    return [...groups].map(([userId, versions]) => ({ userId, versions }));
  }
  async complete(userId: string, courseId: string, materialId: string, versionId: string): Promise<void> {
    await this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${courseId}, 31))::text`;
      const course = await tx.course.findUnique({ where: { id: courseId } });
      const version = await tx.materialVersion.findFirst({ where: { materialId, material: { session: { unit: { courseId } } } }, orderBy: { number: 'desc' } });
      if (course?.status !== 'PUBLICADO' || version?.id !== versionId) throw new CourseError('CONFLICT');
      await tx.contentCompletion.upsert({ where: { userId_versionId: { userId, versionId } }, create: { userId, courseId, materialId, versionId }, update: {} });
    });
  }
  async onModuleDestroy() { await this.db.$disconnect(); }
}
