import { apiClient, createAuthHeaders, createIdempotencyKey } from './client';
import axios from 'axios';
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
  youtubeVideoId: string | null;
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
    youtubeVideoId: dto.youtube_video_id ?? null,
    isDraft: dto.is_draft,
  };
}

export async function generateRoadmap(goal: string): Promise<WeekModule[]> {
  const normalizedGoal = goal.trim();
  if (normalizedGoal.length < 3) {
    throw new Error('Muc tieu can toi thieu 3 ky tu.');
  }
  if (normalizedGoal.length > 500) {
    throw new Error('Muc tieu toi da 500 ky tu. Vui long rut gon noi dung.');
  }

  try {
    const response = await apiClient.post<RoadmapGenerateResponseDTO>(
      '/roadmaps/generate',
      { goal: normalizedGoal },
      {
        headers: {
          ...createAuthHeaders(),
        },
      }
    );
    return (response.data.weeks ?? []).map(mapWeekModule);
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 422) {
      throw new Error('Muc tieu khong hop le. Vui long nhap it nhat 3 ky tu ro rang.');
    }

    if (axios.isAxiosError(error)) {
      throw new Error(error.response?.data?.message ?? 'Khong the tao lo trinh luc nay.');
    }

    throw error;
  }
}

export async function generateLessonContent(lessonTitle: string, weekTitle: string): Promise<LessonContent> {
  const response = await apiClient.post<LessonContentDTO>('/lessons/content', { lessonTitle, weekTitle });
  return mapLessonContent(response.data);
}

//export async function searchYouTube(query: string): Promise<YouTubeVideoDTO[]> {
// const response = await apiClient.get<{ videos: YouTubeVideoDTO[] } | YouTubeVideoDTO[]>('/content/youtube', { params: { q: query } });
//  return response.data.videos ?? response.data;
//}

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
