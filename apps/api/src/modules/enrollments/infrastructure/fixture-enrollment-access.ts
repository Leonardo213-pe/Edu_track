import { readFile } from 'node:fs/promises';
import type { EnrollmentAccess } from '../public';
export class NoSynchronizedEnrollments implements EnrollmentAccess {
  async isEnrolled(): Promise<boolean> { return false; }
}
export class FixtureEnrollmentAccess implements EnrollmentAccess {
  constructor(private readonly filename: string) {}
  async isEnrolled(studentId: string, courseId: string): Promise<boolean> {
    const parsed: unknown = JSON.parse(await readFile(this.filename, 'utf8'));
    if (!Array.isArray(parsed) || parsed.some(row => !row || typeof row.studentId !== 'string' || typeof row.courseId !== 'string' || typeof row.active !== 'boolean'))
      throw new Error('Invalid explicitly enabled enrollment fixture file');
    return parsed.some(row => row.studentId === studentId && row.courseId === courseId && row.active === true);
  }
}
