import type { CorpusSource, ReceivedSubmission, PlagiarismCatalog, PlagiarismDirectory, PlagiarismProvider, PlagiarismRuntime, ReportRepository } from './ports';

export class PlagiarismError extends Error {
  constructor(readonly code: 'FORBIDDEN' | 'NOT_FOUND') { super(code); }
}
/**
 * CU-15: consumes SubmissionReceived.v1 asynchronously (outbox of submissions, at-least-once) and asks the provider for
 * the similarity of the received text against the other students' submissions of the same course. Idempotent per file.
 */
export class PlagiarismService {
  constructor(private readonly reports: ReportRepository, private readonly submissions: CorpusSource, private readonly provider: PlagiarismProvider,
    private readonly catalog: PlagiarismCatalog, private readonly directory: PlagiarismDirectory, private readonly runtime: PlagiarismRuntime) {}

  async handle(event: ReceivedSubmission): Promise<void> {
    if (event.type !== 'SubmissionReceived.v1' || await this.reports.exists(event.fileId)) return;
    const corpus = await this.submissions.corpusFor(event.fileId); if (!corpus) return;
    const comparable = corpus.others.filter((item): item is typeof item & { text: string } => !!item.text);
    const result = corpus.document.text ? await this.provider.check(corpus.document.text, comparable.map(item => ({ id: item.submissionId, text: item.text }))) : null;
    const owners = new Map(comparable.map(item => [item.submissionId, item.studentId]));
    await this.reports.save({ id: this.runtime.id(), fileId: event.fileId, submissionId: event.submissionId, assessmentId: event.assessmentId, courseId: event.courseId,
      studentId: event.studentId, status: result ? 'COMPLETED' : 'UNSUPPORTED', similarityBp: result?.similarityBp ?? null,
      matches: (result?.matches ?? []).map(match => ({ submissionId: match.id, studentId: owners.get(match.id)!, similarityBp: match.similarityBp })),
      provider: this.provider.name, comparedWith: comparable.length, createdAt: this.runtime.now() });
  }
  /** Similarity reports of an assignment: responsible teacher or ADMIN only (never shown to students). */
  async forAssessment(actorId: string, assessmentId: string) {
    const assessment = await this.catalog.assessment(assessmentId); if (!assessment) throw new PlagiarismError('NOT_FOUND');
    const course = await this.catalog.course(assessment.courseId); if (!course) throw new PlagiarismError('NOT_FOUND');
    const role = await this.directory.role(actorId);
    if (!(role === 'ADMIN' || (role === 'TEACHER' && course.teacherId === actorId))) throw new PlagiarismError('FORBIDDEN');
    const reports = await this.reports.forAssessment(assessmentId);
    const names = await this.directory.names([...new Set(reports.flatMap(report => report.matches.map(match => match.studentId)))]);
    return { provider: this.provider.name, simulated: this.provider.name.startsWith('SIMULADO'), reports: reports.map(report => ({
      fileId: report.fileId, submissionId: report.submissionId, studentId: report.studentId, status: report.status, comparedWith: report.comparedWith,
      similarity: report.similarityBp === null ? null : report.similarityBp / 100, createdAt: report.createdAt, provider: report.provider,
      matches: report.matches.map(match => ({ studentId: match.studentId, displayName: names.get(match.studentId) ?? match.studentId, similarity: match.similarityBp / 100 })) })) };
  }
}
