// Reserved for Dexie schema definitions.
// Suggested tables: lessons_cache, roadmap_cache, idempotency_queue.

export interface LessonsCacheRow {
  lessonId: string;
  content: string;
  version: number;
  updatedAt: string;
}
