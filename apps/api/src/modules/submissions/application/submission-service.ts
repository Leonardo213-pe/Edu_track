import { assertCanSubmit, MAX_SUBMISSION_BYTES, staffAccess, SubmissionError, validFilename, type Actor, type Assignment } from '../domain/submission';
import type { FileInput, FileRecord, SubmissionCatalog, SubmissionDirectory, SubmissionReceipts, SubmissionRecord, SubmissionRepository, SubmissionRuntime, SubmissionStorage, TextExtractor } from './ports';

const fileView = (file: FileRecord) => ({ id: file.id, version: file.version, filename: file.filename, mimeType: file.mimeType, size: file.size, sha256: file.sha256, receivedAt: file.receivedAt });

/**
 * CU-04: an enrolled student submits the file of a rubric assignment ("Tarea") before the deadline and may replace it
 * until then; every version is kept. Reception and SubmissionReceived.v1 commit together (outbox). The responsible
 * teacher reviews, downloads and grades with the rubric (grading module).
 */
export class SubmissionService {
  constructor(private readonly repo: SubmissionRepository, private readonly storage: SubmissionStorage, private readonly extractor: TextExtractor,
    private readonly directory: SubmissionDirectory, private readonly catalog: SubmissionCatalog, private readonly receipts: SubmissionReceipts,
    private readonly runtime: SubmissionRuntime) {}

  private async actor(id: string): Promise<Actor> {
    const actor = await this.directory.find(id); if (!actor) throw new SubmissionError('FORBIDDEN'); return actor;
  }
  private async context(assessmentId: string) {
    const assignment = await this.catalog.assignment(assessmentId);
    const course = assignment ? await this.catalog.course(assignment.courseId) : null;
    return { assignment, course };
  }
  /** Runs before the multipart parser so only an enrolled student of an open assignment makes the server receive bytes. */
  async authorizeUpload(actorId: string, assessmentId: string): Promise<Assignment> {
    const actor = await this.actor(actorId); const { assignment, course } = await this.context(assessmentId);
    const enrolled = !!assignment && actor.role === 'STUDENT' && await this.catalog.enrolled(actor.id, assignment.courseId);
    assertCanSubmit(actor, assignment, course, enrolled);
    return assignment;
  }
  async submit(actorId: string, assessmentId: string, file: FileInput) {
    const assignment = await this.authorizeUpload(actorId, assessmentId);
    if (!validFilename(file.filename) || file.bytes.length === 0 || file.bytes.length > MAX_SUBMISSION_BYTES) throw new SubmissionError('FILE_REJECTED');
    const stored = await this.storage.put(file);
    let text: string | null = null;
    try { text = await this.extractor.extract(file); } catch { text = null; } // no text only means "similarity not available"
    const existing = await this.repo.find(assessmentId, actorId);
    let record: SubmissionRecord | null;
    try {
      record = await this.repo.receive({ submissionId: existing?.id ?? this.runtime.id(), fileId: this.runtime.id(), eventId: this.runtime.id(),
        assessmentId, courseId: assignment.courseId, studentId: actorId, dueAt: assignment.dueAt, file: stored, text });
    } catch (error) { await this.storage.remove(stored.key).catch(() => undefined); throw error; }
    if (!record) { await this.storage.remove(stored.key).catch(() => undefined); throw new SubmissionError('DEADLINE_PASSED'); }
    // Receipt in the inbox is best effort: the submission is already durable.
    await this.receipts.received(actorId, assignment, record.version).catch(() => undefined);
    return this.mine(actorId, assessmentId);
  }
  async mine(actorId: string, assessmentId: string) {
    const actor = await this.actor(actorId); if (actor.role !== 'STUDENT') throw new SubmissionError('FORBIDDEN');
    const { assignment, course } = await this.context(assessmentId);
    if (!assignment || !course || assignment.status === 'DRAFT' || course.status !== 'PUBLICADO' || assignment.type !== 'RUBRIC') throw new SubmissionError('NOT_FOUND');
    if (!await this.catalog.enrolled(actor.id, assignment.courseId)) throw new SubmissionError('NOT_ENROLLED');
    const submission = await this.repo.find(assessmentId, actor.id);
    return { assessmentId, title: assignment.title, dueAt: assignment.dueAt, status: assignment.status,
      submission: submission ? { id: submission.id, version: submission.version, firstSubmittedAt: submission.firstSubmittedAt, updatedAt: submission.updatedAt,
        current: fileView(submission.current), history: (await this.repo.history(submission.id)).map(fileView) } : null,
      score: await this.catalog.scoreOf(assessmentId, actor.id) };
  }
  async forAssessment(actorId: string, assessmentId: string) {
    const actor = await this.actor(actorId); const { assignment, course } = await this.context(assessmentId);
    if (!assignment || !course) throw new SubmissionError('NOT_FOUND');
    const access = staffAccess(actor, course);
    if (assignment.type !== 'RUBRIC') throw new SubmissionError('NOT_AN_ASSIGNMENT');
    const submissions = new Map((await this.repo.forAssessment(assessmentId)).map(item => [item.studentId, item]));
    const students = [...new Set([...await this.catalog.studentsOf(assignment.courseId), ...submissions.keys()])];
    const names = await this.directory.names(students);
    const rows = [];
    for (const studentId of students) {
      const submission = submissions.get(studentId);
      rows.push({ studentId, displayName: names.get(studentId) ?? studentId,
        submission: submission ? { id: submission.id, version: submission.version, updatedAt: submission.updatedAt, current: fileView(submission.current) } : null,
        score: await this.catalog.scoreOf(assessmentId, studentId) });
    }
    rows.sort((a, b) => a.displayName.localeCompare(b.displayName, 'es'));
    return { assessmentId, title: assignment.title, dueAt: assignment.dueAt, canGrade: access === 'TEACHER', rows };
  }
  async download(actorId: string, fileId: string) {
    const actor = await this.actor(actorId); const file = await this.repo.file(fileId); if (!file) throw new SubmissionError('NOT_FOUND');
    if (!(actor.role === 'STUDENT' && file.studentId === actor.id)) {
      const course = await this.catalog.course(file.courseId); if (!course) throw new SubmissionError('NOT_FOUND');
      staffAccess(actor, course);
    }
    return { filename: file.filename, mimeType: file.mimeType, bytes: await this.storage.read(file.storageKey) };
  }
}
