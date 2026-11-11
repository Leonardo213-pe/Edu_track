import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Prisma } from './generated/client';
import type { IdentityData, RecoveryRecord, ResetMailer, ResetMessage, SecurityAction, SecurityEvent, SessionRecord, UserRepository } from '../../application/ports';
import { User } from '../../domain/user';
import { IdentityError } from '../../domain/errors';
import type { Role } from '../../public';
import { RecoveryCipher } from '../security/recovery-cipher';

class PrismaIdentityData implements IdentityData {
  constructor(protected readonly db: Prisma.TransactionClient, protected readonly cipher: RecoveryCipher) {}
  private map(row: { id: string; email: string; displayName: string; passwordHash: string; role: Role; createdAt: Date; active: boolean; version: number }): User {
    return new User(row.id, row.email, row.displayName, row.passwordHash, row.role, row.createdAt, row.active, row.version);
  }
  async findByEmail(email: string) { const row = await this.db.user.findUnique({ where: { email } }); return row ? this.map(row) : null; }
  async findById(id: string) { const row = await this.db.user.findUnique({ where: { id } }); return row ? this.map(row) : null; }
  async create(user: User): Promise<void> {
    try { await this.db.user.create({ data: { ...user } }); }
    catch (error) { this.translate(error); }
  }
  async update(user: User, expectedVersion: number): Promise<void> {
    try {
      const result = await this.db.user.updateMany({ where: { id: user.id, version: expectedVersion }, data: {
        email: user.email, displayName: user.displayName, passwordHash: user.passwordHash, role: user.role, active: user.active, version: user.version,
      } });
      if (result.count !== 1) throw new IdentityError('CONFLICT');
    } catch (error) { this.translate(error); }
  }
  private translate(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new IdentityError('EMAIL_EXISTS');
    throw error;
  }
  async list(limit: number, offset: number) {
    return (await this.db.user.findMany({ take: limit, skip: offset, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] })).map(row => this.map(row));
  }
  countActiveAdmins() { return this.db.user.count({ where: { active: true, role: 'ADMIN' } }); }
  findSession(id: string) { return this.db.session.findUnique({ where: { id } }); }
  async createSession(session: SessionRecord) { await this.db.session.create({ data: session }); }
  async revokeSession(id: string, now: Date) { await this.db.session.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: now } }); }
  async revokeSessions(userId: string, now: Date) { await this.db.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } }); }
  findRecovery(tokenHash: string) { return this.db.passwordRecovery.findUnique({ where: { tokenHash } }); }
  latestRecovery(userId: string) { return this.db.passwordRecovery.findFirst({ where: { userId }, orderBy: { expiresAt: 'desc' } }); }
  async createRecovery(recovery: RecoveryRecord, message: ResetMessage) {
    await this.db.passwordRecovery.create({ data: recovery });
    await this.db.recoveryMessage.create({ data: { userId: recovery.userId, payload: this.cipher.seal(message) } });
  }
  async removeRecoveries(userId: string) {
    await this.db.passwordRecovery.deleteMany({ where: { userId } });
    await this.db.recoveryMessage.deleteMany({ where: { userId } });
  }
  async appendEvent(event: SecurityEvent) { await this.db.securityEvent.create({ data: event }); }
  async listEvents(limit: number, offset: number): Promise<SecurityEvent[]> {
    const rows = await this.db.securityEvent.findMany({ take: limit, skip: offset, orderBy: [{ occurredAt: 'desc' }, { id: 'asc' }] });
    return rows.map(row => ({ ...row, action: row.action as SecurityAction }));
  }
}
export class PrismaUserRepository extends PrismaIdentityData implements UserRepository {
  private readonly client: PrismaClient;
  constructor(connectionString: string, encryptionSecret: string) {
    const client = new PrismaClient({ adapter: new PrismaPg({ connectionString, max: 10, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000 }) });
    super(client, new RecoveryCipher(encryptionSecret)); this.client = client;
  }
  transaction<T>(work: (data: IdentityData) => Promise<T>): Promise<T> {
    return this.client.$transaction(async tx => {
      // Only identity mutations serialize; hashing and SMTP run outside this critical section.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(17322013)::text`;
      return work(new PrismaIdentityData(tx, this.cipher));
    }, { timeout: 15000, maxWait: 10000 });
  }
  async dispatchRecovery(mailer: ResetMailer): Promise<void> {
    await this.client.$transaction(async tx => {
      const rows = await tx.$queryRaw<{ id: string; userId: string; payload: string; attempts: number }[]>`
        SELECT id, "userId", payload, attempts FROM identity.recovery_messages
        WHERE "deliveredAt" IS NULL AND "availableAt" <= now() AND attempts < 5
        ORDER BY "availableAt" LIMIT 1 FOR UPDATE SKIP LOCKED`;
      const row = rows[0]; if (!row) return;
      try {
        const message = this.cipher.open(row.payload);
        if (new Date(message.expiresAt) <= new Date()) throw new Error('Expired reset notification');
        await mailer.send(message);
        await tx.recoveryMessage.update({ where: { id: row.id }, data: { deliveredAt: new Date(), payload: '' } });
        await tx.securityEvent.create({ data: { id: randomUUID(), action: 'RECOVERY_DELIVERED', userId: row.userId, occurredAt: new Date() } });
      } catch {
        await tx.recoveryMessage.update({ where: { id: row.id }, data: { attempts: row.attempts + 1,
          availableAt: new Date(Date.now() + 5000 * 2 ** row.attempts) } });
        await tx.securityEvent.create({ data: { id: randomUUID(), action: 'RECOVERY_DELIVERY_FAILED', userId: row.userId, occurredAt: new Date() } });
      }
    }, { timeout: 15000 });
  }
  async ping(): Promise<void> { await this.client.$queryRaw`SELECT 1`; }
  async onModuleDestroy(): Promise<void> { await this.client.$disconnect(); }
}
