export const COURSE_CATALOG = Symbol('COURSE_CATALOG');
export interface CourseCatalog {
  findPublished(id: string): Promise<{ id: string; code: string; name: string; teacherId: string } | null>;
}
