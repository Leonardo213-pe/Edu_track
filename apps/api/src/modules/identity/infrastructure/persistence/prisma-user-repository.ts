import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Prisma } from './generated/client';
import type { UserRepository } from '../../application/ports';
import { User } from '../../domain/user';
import { IdentityError } from '../../domain/errors';
import type { Role } from '../../public';

export class PrismaUserRepository implements UserRepository {
  private readonly db: PrismaClient;
  constructor(connectionString: string) {
    this.db = new PrismaClient({ adapter: new PrismaPg({ connectionString, max: 10,
      connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000 }) });
  }
  async findByEmail(email: string): Promise<User | null> {
    const row = await this.db.user.findUnique({ where: { email } });
    return row ? this.map(row) : null;
  }
  async findById(id: string): Promise<User | null> {
    const row = await this.db.user.findUnique({ where: { id } });
    return row ? this.map(row) : null;
  }
  async create(user: User): Promise<void> {
    try {
      await this.db.user.create({ data: { id: user.id, email: user.email, displayName: user.displayName,
        passwordHash: user.passwordHash, role: user.role, createdAt: user.createdAt } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new IdentityError('EMAIL_EXISTS');
      throw error;
    }
  }
  async list(limit: number, offset: number): Promise<User[]> {
    return (await this.db.user.findMany({ take: limit, skip: offset, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] }))
      .map(row => this.map(row));
  }
  async ping(): Promise<void> { await this.db.$queryRaw`SELECT 1`; }
  async onModuleDestroy(): Promise<void> { await this.db.$disconnect(); }
  private map(row: { id: string; email: string; displayName: string; passwordHash: string; role: Role; createdAt: Date }): User {
    return new User(row.id, row.email, row.displayName, row.passwordHash, row.role, row.createdAt);
  }
}
