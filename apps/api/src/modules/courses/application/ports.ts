import type { Actor, ChangeAction, Course, CourseData, CourseStatus } from '../domain/course';
export interface CourseFilter { teacherId?: string; ids?: string[]; statuses?: CourseStatus[] }
export interface CourseHistoryEntry { id: string; revision: number; actorId: string; action: ChangeAction; detail: Record<string, unknown>; createdAt: string }
export interface CourseRepository {
  create(course: Course): Promise<void>;
  find(id: string): Promise<Course | null>;
  /** Filters are applied by the store; omitted filters mean "all courses". */
  list(filter?: CourseFilter): Promise<Course[]>;
  /** Locks the course, checks the optimistic revision, applies the work and persists structure, decisions and history atomically. */
  mutate(id: string, revision: number, work: (course: Course) => Promise<void>): Promise<Course>;
  history(courseId: string): Promise<CourseHistoryEntry[]>;
  completed(userId: string, courseId: string): Promise<string[]>;
  activity(courseId: string): Promise<{ userId: string; versions: string[] }[]>;
  complete(userId: string, courseId: string, materialId: string, versionId: string): Promise<void>;
}
export interface CourseIdentity {
  find(id: string): Promise<Actor | null>;
  teachers(): Promise<{ id: string; displayName: string }[]>;
  names(ids: string[]): Promise<Map<string, string>>;
}
export interface CourseEnrollment {
  has(userId: string, courseId: string): Promise<boolean>;
  courses(userId: string): Promise<string[]>;
}
export interface FileInput { bytes: Uint8Array; filename: string; mimeType: string }
export interface StoredFile { key: string; filename: string; mimeType: string; size: number; sha256: string }
export interface CourseStorage {
  put(file: FileInput): Promise<StoredFile>;
  remove(key: string): Promise<void>;
  read(key: string): Promise<Uint8Array>;
}
export interface CourseRuntime { id(): string; now(): string }
export type CourseView = CourseData & {
  teacherName?: string; durationMinutes: number;
  progress?: { total: number; completed: number; percentage: number }; completedVersions?: string[]; removable?: boolean;
};
