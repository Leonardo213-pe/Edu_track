export const COURSE_CATALOG = Symbol('COURSE_CATALOG');
export interface CourseSummary { readonly id: string; readonly code: string; readonly name: string; readonly teacherId: string; readonly status: string }
export interface CourseCatalog {
  findPublished(id: string): Promise<{ id: string; code: string; name: string; teacherId: string } | null>;
  /** Minimal course data for other modules (any status); never content, files or review notes. */
  describe(id: string): Promise<CourseSummary | null>;
}
