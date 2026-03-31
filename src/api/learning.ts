import { apiClient, createAuthHeaders, createIdempotencyKey } from './client';
import {
  LessonCompleteResponseDTO,
  LessonContentDTO,
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
