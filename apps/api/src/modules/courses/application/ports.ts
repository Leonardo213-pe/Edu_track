import type { Actor, Course, CourseData } from '../domain/course';
export interface CourseRepository {
  create(course: Course): Promise<void>;
  find(id: string): Promise<Course | null>;
  list(): Promise<Course[]>;
  mutate(id: string, revision: number, work: (course: Course) => Promise<void>): Promise<Course>;
  completed(userId: string, courseId: string): Promise<string[]>;
  activity(courseId: string): Promise<{ userId: string; versions: string[] }[]>;
  complete(userId: string, courseId: string, materialId: string, versionId: string): Promise<void>;
}
export interface CourseIdentity { find(id: string): Promise<Actor | null>; teachers(): Promise<{ id: string; displayName: string }[]> }
export interface CourseEnrollment { has(userId: string, courseId: string): Promise<boolean> }
export interface FileInput { bytes: Uint8Array; filename: string; mimeType: string }
export interface StoredFile { key: string; filename: string; mimeType: string; size: number; sha256: string }
export interface CourseStorage {
  put(file: FileInput): Promise<StoredFile>;
  remove(key: string): Promise<void>;
  read(key: string): Promise<Uint8Array>;
}
export interface CourseRuntime { id(): string; now(): string }
export type CourseView = CourseData & { teacherName?: string; progress?: { total: number; completed: number; percentage: number }; completedVersions?: string[] };
