import { apiClient, createAuthHeaders, createIdempotencyKey } from './client';
import axios from 'axios';
import {
  DocumentCreateRequestDTO,
  DocumentCreateResponseDTO,
  DocumentSummaryDTO,
  FlashcardCompleteResponseDTO,
  LessonCompleteResponseDTO,
  LessonDetailDTO,
  LessonContentDTO,
  LessonGenerateResponseDTO,
  ParserExtractResponseDTO,
  ParserExtractUrlRequestDTO,
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
  quizPassed: boolean;
  flashcardCompleted: boolean;
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
  quizPassed: boolean;
  flashcardCompleted: boolean;
  contentMarkdown: string | null;
  youtubeVideoId: string | null;
  isDraft: boolean;
  sourceContent: string | null;
}

export interface MyDocument {
  id: string;
  title: string;
  isCompleted: boolean;
  quizPassed: boolean;
  flashcardCompleted: boolean;
  createdAt: string;
}

type ParserInput =
  | { mode: 'url'; url: string }
  | { mode: 'file'; file: File };

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
        quizPassed: lesson.quiz_passed ?? false,
        flashcardCompleted: lesson.flashcard_completed ?? false,
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
    roadmapId: dto.roadmap_id ?? 0,
    roadmapTitle: dto.roadmap_title ?? 'NotebookLM Mini',
    isCompleted: dto.is_completed,
    quizPassed: dto.quiz_passed ?? false,
    flashcardCompleted: dto.flashcard_completed ?? false,
    sourceContent: dto.source_content ?? null,
    contentMarkdown: dto.content_markdown ?? null,
    youtubeVideoId: dto.youtube_video_id ?? null,
    isDraft: dto.is_draft,
  };
}

function mapDocumentSummary(dto: DocumentSummaryDTO): MyDocument {
  return {
    id: String(dto.id),
    title: dto.title,
    isCompleted: dto.is_completed,
    quizPassed: dto.quiz_passed ?? false,
    flashcardCompleted: dto.flashcard_completed ?? false,
    createdAt: dto.created_at,
  };
}

export async function createDocument(payload: DocumentCreateRequestDTO): Promise<DocumentCreateResponseDTO> {
  const normalizedTitle = payload.title.trim();
  const normalizedSource = payload.source_content.trim();

  if (normalizedTitle.length < 3) {
    throw new Error('Tieu de can toi thieu 3 ky tu.');
  }
  if (normalizedSource.length < 30) {
    throw new Error('Noi dung tai lieu can toi thieu 30 ky tu.');
  }

  try {
    const response = await apiClient.post<DocumentCreateResponseDTO>(
      '/documents',
      {
        title: normalizedTitle,
        source_content: normalizedSource,
      },
      {
        headers: {
          ...createAuthHeaders(),
        },
      }
    );
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 422) {
      throw new Error('Du lieu khong hop le. Vui long kiem tra tieu de va noi dung tai lieu.');
    }

    if (axios.isAxiosError(error)) {
      throw new Error(error.response?.data?.message ?? 'Khong the tao tai lieu luc nay.');
    }

    throw error;
  }
}

export async function getMyDocuments(): Promise<MyDocument[]> {
  const response = await apiClient.get<DocumentSummaryDTO[]>('/documents', {
    headers: {
      ...createAuthHeaders(),
    },
  });

  return (response.data ?? []).map(mapDocumentSummary);
}

function normalizeParserError(error: unknown): Error {
  if (!axios.isAxiosError(error)) {
    return new Error('Khong the trich xuat noi dung luc nay. Vui long thu lai.');
  }

  const status = error.response?.status;
  const code = error.response?.data?.detail?.code as string | undefined;

  if (status === 413 || code === 'PARSER_FILE_TOO_LARGE' || code === 'PARSER_URL_TOO_LARGE') {
    return new Error('Du lieu qua lon. Vui long thu voi tai lieu nho hon.');
  }

  if (code === 'PARSER_URL_INVALID' || code === 'PARSER_URL_REQUIRED') {
    return new Error('Link khong hop le. Vui long nhap URL bat dau bang http/https.');
  }

  if (code === 'PARSER_URL_TIMEOUT') {
    return new Error('Khong the tai link trong thoi gian cho phep. Vui long thu lai.');
  }

  if (code === 'PARSER_URL_FETCH_FAILED' || code === 'PARSER_URL_EXTRACT_FAILED') {
    return new Error('Khong the truy cap hoac trich xuat noi dung tu link nay.');
  }

  if (code === 'PARSER_UNSUPPORTED_FORMAT' || code === 'PARSER_URL_UNSUPPORTED_CONTENT') {
    return new Error('Dinh dang hien tai chua duoc ho tro. Hay dung PDF, DOCX, JPG, PNG hoac WEBP.');
  }

  if (code === 'PARSER_FILE_EMPTY' || code === 'PARSER_INPUT_REQUIRED') {
    return new Error('Khong tim thay noi dung hop le de trich xuat.');
  }

  if (code === 'PARSER_TEXT_EMPTY') {
    return new Error('Khong trich xuat duoc van ban ro rang tu nguon da chon.');
  }

  if (code === 'LLM_TIMEOUT' || code === 'LLM_SERVICE_ERROR') {
    return new Error('Dich vu OCR AI tam thoi qua tai. Vui long thu lai sau it phut.');
  }

  return new Error(error.response?.data?.message ?? 'Khong the trich xuat noi dung luc nay.');
}

export async function extractTextFromParser(input: ParserInput): Promise<ParserExtractResponseDTO> {
  try {
    if (input.mode === 'url') {
      const normalizedUrl = input.url.trim();
      if (!normalizedUrl) {
        throw new Error('Link khong duoc de trong.');
      }

      const payload: ParserExtractUrlRequestDTO = {
        url: normalizedUrl,
      };

      const response = await apiClient.post<ParserExtractResponseDTO>(
        '/parser/extract-text',
        payload,
        {
          headers: {
            ...createAuthHeaders(),
          },
        }
      );

      return response.data;
    }

    const file = input.file;
    if (!file) {
      throw new Error('Khong tim thay file de trich xuat.');
    }

    const formData = new FormData();
    formData.append('file', file);

    const response = await apiClient.post<ParserExtractResponseDTO>(
      '/parser/extract-text',
      formData,
      {
        headers: {
          ...createAuthHeaders(),
          'Content-Type': 'multipart/form-data',
        },
      }
    );

    return response.data;
  } catch (error) {
    if (error instanceof Error && !axios.isAxiosError(error)) {
      throw error;
    }

    throw normalizeParserError(error);
  }
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

export async function completeFlashcardProgress(lessonId: string): Promise<FlashcardCompleteResponseDTO> {
  const response = await apiClient.post<FlashcardCompleteResponseDTO>(
    `/lessons/${lessonId}/flashcards/complete`,
    {},
    {
      headers: {
        ...createAuthHeaders(),
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
