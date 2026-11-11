import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Prisma } from './generated/client';
import { Course, CourseError, type CourseData } from '../../domain/course';
import type { CourseRepository } from '../../application/ports';
const tree = { units: { orderBy: { position: 'asc' as const }, include: { sessions: { orderBy: { position: 'asc' as const }, include: {
  materials: { orderBy: { position: 'asc' as const }, include: { versions: { orderBy: { number: 'asc' as const } } } },
} } } }, reviews: { orderBy: { createdAt: 'asc' as const } } };
type Row = Prisma.CourseGetPayload<{ include: typeof tree }>;
export class PrismaCourseRepository implements CourseRepository {
  private readonly db: PrismaClient;
  constructor(url: string) { this.db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max: 10, connectionTimeoutMillis: 5000 }) }); }
  private map(row: Row): Course {
    return new Course({ ...row, createdAt: row.createdAt.toISOString(), units: row.units.map(({ courseId, ...unit }) => ({ ...unit, sessions: unit.sessions.map(({ unitId, ...session }) => ({ ...session,
      materials: session.materials.map(({ sessionId, ...material }) => ({ ...material, versions: material.versions.map(({ materialId, ...version }) => ({ ...version, kind: version.kind as 'FILE' | 'LINK' | 'VIDEO', createdAt: version.createdAt.toISOString() })) })) })) })),
      reviews: row.reviews.map(({ courseId, ...review }) => ({ ...review, decision: review.decision as CourseData['reviews'][number]['decision'], createdAt: review.createdAt.toISOString() })) });
  }
  private translate(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new CourseError('CONFLICT'); throw error;
  }
  async create(course: Course): Promise<void> {
    const { units, reviews, ...data } = course.data;
    try { await this.db.course.create({ data: { ...data, createdAt: new Date(data.createdAt) } }); } catch (error) { this.translate(error); }
  }
  async find(id: string) { const row = await this.db.course.findUnique({ where: { id }, include: tree }); return row ? this.map(row) : null; }
  async list() { return (await this.db.course.findMany({ include: tree, orderBy: { createdAt: 'desc' } })).map(row => this.map(row)); }
  async mutate(id: string, revision: number, work: (course: Course) => Promise<void>): Promise<Course> {
    try { return await this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 31))::text`;
      const row = await tx.course.findUnique({ where: { id }, include: tree }); if (!row) throw new CourseError('NOT_FOUND');
      if (row.revision !== revision) throw new CourseError('CONFLICT'); const course = this.map(row); await work(course); course.data.revision++;
      const { units, reviews, createdAt, ...scalar } = course.data; await tx.course.update({ where: { id }, data: scalar });
      for (const unit of units) {
        const { sessions, ...data } = unit; await tx.courseUnit.upsert({ where: { id: unit.id }, create: { ...data, courseId: id }, update: { title: unit.title, position: unit.position } });
        for (const session of sessions) {
          const { materials, ...sessionData } = session; await tx.courseSession.upsert({ where: { id: session.id }, create: { ...sessionData, unitId: unit.id }, update: { title: session.title, description: session.description, position: session.position } });
          for (const material of materials) {
            const { versions, ...materialData } = material; await tx.courseMaterial.upsert({ where: { id: material.id }, create: { ...materialData, sessionId: session.id }, update: { title: material.title, position: material.position } });
            await tx.materialVersion.createMany({ data: versions.map(version => ({ ...version, createdAt: new Date(version.createdAt), materialId: material.id })), skipDuplicates: true });
          }
        }
      }
      await tx.courseReview.createMany({ data: reviews.map(review => ({ ...review, createdAt: new Date(review.createdAt), courseId: id })), skipDuplicates: true }); return course;
    }, { timeout: 20000 }); } catch (error) { this.translate(error); }
  }
  async completed(userId: string, courseId: string): Promise<string[]> { return (await this.db.contentCompletion.findMany({ where: { userId, courseId }, select: { versionId: true } })).map(row => row.versionId); }
  async activity(courseId: string) {
    const records = await this.db.contentCompletion.findMany({ where: { courseId }, select: { userId: true, versionId: true } });
    const groups = new Map<string, string[]>(); for (const row of records) { const list = groups.get(row.userId) ?? []; list.push(row.versionId); groups.set(row.userId, list); }
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
