import type { Actor, Assignment, CourseFacts } from '../domain/submission';

export interface StoredFile { key: string; filename: string; mimeType: string; size: number; sha256: string }
export interface FileInput { bytes: Uint8Array; filename: string; mimeType: string }
export interface SubmissionStorage {
  /** Validates format/content/size and stores the bytes; throws SubmissionError('FILE_REJECTED'). */
  put(file: FileInput): Promise<StoredFile>;
  read(key: string): Promise<Uint8Array>;
  remove(key: string): Promise<void>;
}
/** Extracts plain text for the similarity check; null when the format carries no extractable text. */
export interface TextExtractor { extract(file: FileInput): Promise<string | null> }
export interface FileRecord { id: string; submissionId: string; version: number; storageKey: string; filename: string; mimeType: string; size: number; sha256: string; receivedAt: string }
export interface SubmissionRecord {
  id: string; assessmentId: string; courseId: string; studentId: string; version: number; currentFileId: string;
  firstSubmittedAt: string; updatedAt: string; current: FileRecord;
}
export interface ReceiveCommand {
  submissionId: string; fileId: string; eventId: string; assessmentId: string; courseId: string; studentId: string; dueAt: string;
  file: StoredFile; text: string | null;
}
export interface SubmissionRepository {
  /**
   * Stores a new version (first submission or replacement) and SubmissionReceived.v1 in the outbox in ONE transaction,
   * after checking the deadline with the database clock. Returns null when the deadline has passed.
   */
  receive(command: ReceiveCommand): Promise<SubmissionRecord | null>;
  find(assessmentId: string, studentId: string): Promise<SubmissionRecord | null>;
  forAssessment(assessmentId: string): Promise<SubmissionRecord[]>;
  history(submissionId: string): Promise<FileRecord[]>;
  file(fileId: string): Promise<(FileRecord & { assessmentId: string; courseId: string; studentId: string }) | null>;
}
export interface SubmissionDirectory { find(id: string): Promise<Actor | null>; names(ids: string[]): Promise<Map<string, string>> }
export interface SubmissionCatalog {
  assignment(id: string): Promise<Assignment | null>;
  course(id: string): Promise<CourseFacts | null>;
  enrolled(studentId: string, courseId: string): Promise<boolean>;
  studentsOf(courseId: string): Promise<string[]>;
  scoreOf(assessmentId: string, studentId: string): Promise<number | null>;
}
export interface SubmissionReceipts { received(studentId: string, assignment: Assignment, version: number): Promise<void> }
export interface SubmissionRuntime { id(): string }
