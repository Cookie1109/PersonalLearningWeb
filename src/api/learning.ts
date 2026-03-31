import { apiClient, createAuthHeaders, createIdempotencyKey } from './client';
import {
  LessonCompleteResponseDTO,
  LessonDetailDTO,
  LessonContentDTO,
  LessonGenerateResponseDTO,
  RoadmapItemDTO,
  RoadmapGenerateResponseDTO,
  WeekModuleDTO,
  YouTubeVideoDTO,
} from './dto';
import { LessonContent, WeekModule } from '../app/lib/types';

export interface MyRoadmapLesson {
  id: string;
  title: string;
  isCompleted: boolean;
}

export interface MyRoadmapWeek {
  weekNumber: number;
  title: string;
  lessons: MyRoadmapLesson[];
}

export interface MyRoadmap {
  roadmapId: number;
  goal: string;
  title: string;
  weeks: MyRoadmapWeek[];
}

export interface LessonDetail {
  id: number;
  title: string;
  weekNumber: number;
  position: number;
  roadmapId: number;
  roadmapTitle: string;
  isCompleted: boolean;
  contentMarkdown: string | null;
  isDraft: boolean;
}

function mapWeekModule(dto: WeekModuleDTO): WeekModule {
  return {
    id: dto.id,
    weekNumber: dto.week_number,
    title: dto.title,
    description: dto.description,
    lessons: dto.lessons,
    completed: dto.completed,
    expanded: dto.expanded,
  };
}

function mapLessonContent(dto: LessonContentDTO): LessonContent {
  return {
    title: dto.title,
    theory: dto.theory,
    examples: dto.examples.map(ex => ({
      title: ex.title,
      description: ex.description,
      code: ex.code ?? undefined,
    })),
    keyPoints: dto.key_points,
    youtubeQuery: dto.youtube_query,
  };
}

function mapRoadmapItem(dto: RoadmapItemDTO): MyRoadmap {
  return {
    roadmapId: dto.roadmap_id,
    goal: dto.goal,
    title: dto.title,
    weeks: (dto.weeks ?? []).map(week => ({
      weekNumber: week.week_number,
      title: week.title,
      lessons: (week.lessons ?? []).map(lesson => ({
        id: String(lesson.id),
        title: lesson.title,
        isCompleted: lesson.is_completed,
      })),
    })),
  };
}

function mapLessonDetail(dto: LessonDetailDTO): LessonDetail {
  return {
    id: dto.id,
    title: dto.title,
    weekNumber: dto.week_number,
    position: dto.position,
    roadmapId: dto.roadmap_id,
    roadmapTitle: dto.roadmap_title,
    isCompleted: dto.is_completed,
    contentMarkdown: dto.content_markdown ?? null,
    isDraft: dto.is_draft,
  };
}

export async function generateRoadmap(goal: string): Promise<WeekModule[]> {
  const response = await apiClient.post<RoadmapGenerateResponseDTO>(
    '/roadmaps/generate',
    { goal },
    {
      headers: {
        ...createAuthHeaders(),
      },
    }
  );
  return (response.data.weeks ?? []).map(mapWeekModule);
}

export async function generateLessonContent(lessonTitle: string, weekTitle: string): Promise<LessonContent> {
  const response = await apiClient.post<LessonContentDTO>('/lessons/content', { lessonTitle, weekTitle });
  return mapLessonContent(response.data);
}

export async function searchYouTube(query: string): Promise<YouTubeVideoDTO[]> {
  const response = await apiClient.get<{ videos: YouTubeVideoDTO[] } | YouTubeVideoDTO[]>('/content/youtube', { params: { q: query } });
  return response.data.videos ?? response.data;
}

export async function completeLessonProgress(lessonId: string): Promise<LessonCompleteResponseDTO> {
  const response = await apiClient.post<LessonCompleteResponseDTO>(
    `/lessons/${lessonId}/complete`,
    {},
    {
      headers: {
        ...createAuthHeaders(),
        'Idempotency-Key': createIdempotencyKey(),
      },
    }
  );

  return response.data;
}

export async function getMyRoadmaps(): Promise<MyRoadmap[]> {
  const response = await apiClient.get<RoadmapItemDTO[]>('/roadmaps/me', {
    headers: {
      ...createAuthHeaders(),
    },
  });

  return (response.data ?? []).map(mapRoadmapItem);
}

export async function getLessonDetail(lessonId: string): Promise<LessonDetail> {
  const response = await apiClient.get<LessonDetailDTO>(`/lessons/${lessonId}`, {
    headers: {
      ...createAuthHeaders(),
    },
  });

  return mapLessonDetail(response.data);
}

export async function generateLesson(lessonId: string): Promise<LessonDetail> {
  const response = await apiClient.post<LessonGenerateResponseDTO>(
    `/lessons/${lessonId}/generate`,
    {},
    {
      headers: {
        ...createAuthHeaders(),
      },
    }
  );

  return mapLessonDetail(response.data.lesson);
}
