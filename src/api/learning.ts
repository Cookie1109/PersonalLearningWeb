import { apiClient, createAuthHeaders, createIdempotencyKey } from './client';
import axios from 'axios';
import {
  DocumentChatRequestDTO,
  DocumentChatResponseDTO,
  DocumentCreateRequestDTO,
  DocumentCreateResponseDTO,
  DocumentDeleteResponseDTO,
  DocumentPageDTO,
  DocumentRenameRequestDTO,
  DocumentUploadResponseDTO,
  DocumentSummaryDTO,
  FlashcardCompleteResponseDTO,
  LessonCompleteResponseDTO,
  LessonDetailDTO,
  LessonGenerateResponseDTO,
  ParserExtractResponseDTO,
  ParserExtractUrlRequestDTO,
  RoadmapItemDTO,
  RoadmapGenerateResponseDTO,
  WeekModuleDTO,
} from './dto';
import { WeekModule } from '../app/lib/types';

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
  sourceFileUrl: string | null;
  sourceFileName: string | null;
  sourceFileMimeType: string | null;
}

export interface MyDocument {
  id: string;
  title: string;
  isCompleted: boolean;
  quizPassed: boolean;
  flashcardCompleted: boolean;
  createdAt: string;
}

export interface MyDocumentPage {
  items: MyDocument[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export function isRequestCanceledError(error: unknown): boolean {
  return axios.isCancel(error) || (axios.isAxiosError(error) && error.code === 'ERR_CANCELED');
}

export interface DocumentChatHistoryItem {
  role: 'user' | 'assistant';
  content: string;
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
    roadmapTitle: dto.roadmap_title ?? 'NEXL',
    isCompleted: dto.is_completed,
    quizPassed: dto.quiz_passed ?? false,
    flashcardCompleted: dto.flashcard_completed ?? false,
    sourceContent: dto.source_content ?? null,
    sourceFileUrl: dto.source_file_url ?? null,
    sourceFileName: dto.source_file_name ?? null,
    sourceFileMimeType: dto.source_file_mime_type ?? null,
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
    throw new Error('Tiêu đề cần tối thiểu 3 ký tự.');
  }
  if (normalizedSource.length < 30) {
    throw new Error('Nội dung tài liệu cần tối thiểu 30 ký tự.');
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
      throw new Error('Dữ liệu không hợp lệ. Vui lòng kiểm tra tiêu đề và nội dung tài liệu.');
    }

    if (axios.isAxiosError(error)) {
      const backendMessage = error.response?.data?.message as string | undefined;
      const backendDetailError = error.response?.data?.detail?.error as string | undefined;
      if (backendMessage === 'Internal Server Error' && backendDetailError) {
        throw new Error(`Internal Server Error: ${backendDetailError}`);
      }
      throw new Error(backendMessage ?? 'Không thể tạo tài liệu lúc này.');
    }

    throw error;
  }
}

export async function createDocumentFromUpload(file: File, title?: string): Promise<DocumentUploadResponseDTO> {
  if (!file) {
    throw new Error('Không tìm thấy file để tạo Workspace.');
  }

  const formData = new FormData();
  formData.append('file', file);

  const normalizedTitle = (title ?? '').trim();
  if (normalizedTitle.length >= 3) {
    formData.append('title', normalizedTitle);
  }

  try {
    const response = await apiClient.post<DocumentUploadResponseDTO>(
      '/documents/upload',
      formData,
      {
        headers: {
          ...createAuthHeaders(),
          'Content-Type': 'multipart/form-data',
        },
      }
    );

    if (response.status !== 200) {
      throw new Error('Không thể tạo Workspace từ file lúc này.');
    }

    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(error.response?.data?.message ?? 'Không thể tạo Workspace từ file lúc này.');
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

export async function getMyDocumentsPaged(params: {
  page: number;
  pageSize: number;
  search?: string;
  signal?: AbortSignal;
}): Promise<MyDocumentPage> {
  const normalizedPage = Math.max(1, Math.trunc(params.page || 1));
  const normalizedPageSize = Math.min(50, Math.max(1, Math.trunc(params.pageSize || 9)));
  const normalizedSearch = (params.search ?? '').trim();

  const response = await apiClient.get<DocumentPageDTO>('/documents/paged', {
    headers: {
      ...createAuthHeaders(),
    },
    signal: params.signal,
    params: {
      page: normalizedPage,
      page_size: normalizedPageSize,
      ...(normalizedSearch ? { search: normalizedSearch } : {}),
    },
  });

  const payload = response.data;
  return {
    items: (payload?.items ?? []).map(mapDocumentSummary),
    page: payload?.page ?? normalizedPage,
    pageSize: payload?.page_size ?? normalizedPageSize,
    totalItems: payload?.total_items ?? 0,
    totalPages: payload?.total_pages ?? 0,
  };
}

function normalizeDocumentMutationError(error: unknown, action: 'rename' | 'delete'): Error {
  const fallbackMessage = action === 'rename'
    ? 'Không thể đổi tên tài liệu lúc này.'
    : 'Không thể xóa tài liệu lúc này.';

  if (!axios.isAxiosError(error)) {
    if (error instanceof Error) {
      return error;
    }
    return new Error(fallbackMessage);
  }

  const status = error.response?.status;
  const code = error.response?.data?.detail?.code as string | undefined;

  if (status === 404 || code === 'LESSON_NOT_FOUND' || code === 'DOCUMENT_NOT_FOUND') {
    return new Error('Tài liệu không tồn tại hoặc bạn không có quyền truy cập.');
  }

  if (action === 'rename' && status === 409 && code === 'DOCUMENT_TITLE_CONFLICT') {
    return new Error('Tên tài liệu đã tồn tại. Vui lòng chọn tên khác.');
  }

  if (action === 'rename' && status === 409 && code === 'DOCUMENT_TITLE_TOO_SHORT') {
    return new Error('Tên tài liệu cần tối thiểu 3 ký tự.');
  }

  return new Error(error.response?.data?.message ?? fallbackMessage);
}

export async function renameDocument(documentId: string | number, title: string): Promise<MyDocument> {
  const normalizedTitle = title.trim();
  if (normalizedTitle.length < 3) {
    throw new Error('Tên tài liệu cần tối thiểu 3 ký tự.');
  }

  const payload: DocumentRenameRequestDTO = {
    title: normalizedTitle,
  };

  try {
    const response = await apiClient.patch<DocumentSummaryDTO>(
      `/documents/${encodeURIComponent(String(documentId))}`,
      payload,
      {
        headers: {
          ...createAuthHeaders(),
        },
      }
    );

    if (response.status !== 200) {
      throw new Error('Không thể đổi tên tài liệu lúc này.');
    }

    return mapDocumentSummary(response.data);
  } catch (error) {
    throw normalizeDocumentMutationError(error, 'rename');
  }
}

export async function deleteDocument(documentId: string | number): Promise<void> {
  try {
    const response = await apiClient.delete<DocumentDeleteResponseDTO>(
      `/documents/${encodeURIComponent(String(documentId))}`,
      {
        headers: {
          ...createAuthHeaders(),
        },
      }
    );

    if (response.status !== 200) {
      throw new Error('Không thể xóa tài liệu lúc này.');
    }
  } catch (error) {
    throw normalizeDocumentMutationError(error, 'delete');
  }
}

function normalizeDocumentChatError(error: unknown): Error {
  if (!axios.isAxiosError(error)) {
    if (error instanceof Error) {
      return error;
    }
    return new Error('Không thể kết nối hỏi đáp với tài liệu lúc này.');
  }

  const code = error.response?.data?.detail?.code as string | undefined;
  const status = error.response?.status;

  if (status === 404 || code === 'DOCUMENT_NOT_FOUND') {
    return new Error('Tài liệu không tồn tại hoặc bạn không có quyền truy cập.');
  }

  if (code === 'CHAT_MESSAGE_REQUIRED') {
    return new Error('Câu hỏi không được để trống.');
  }

  if (code === 'LLM_TIMEOUT' || code === 'LLM_NETWORK_ERROR' || code === 'LLM_SERVICE_ERROR') {
    return new Error('AI đang bận. Vui lòng thử lại sau ít phút.');
  }

  if (code === 'LLM_AUTH_FAILED' || code === 'LLM_API_KEY_MISSING') {
    return new Error('AI service chưa được cấu hình đúng.');
  }

  return new Error(error.response?.data?.message ?? 'Không thể trả lời câu hỏi lúc này.');
}

export async function chatWithDocument(
  documentId: string | number,
  message: string,
  history: DocumentChatHistoryItem[]
): Promise<string> {
  const normalizedMessage = message.trim();
  if (!normalizedMessage) {
    throw new Error('Câu hỏi không được để trống.');
  }

  const payload: DocumentChatRequestDTO = {
    message: normalizedMessage,
    history: (history ?? [])
      .filter(item => item && (item.role === 'user' || item.role === 'assistant') && item.content?.trim())
      .slice(-20)
      .map(item => ({ role: item.role, content: item.content.trim() })),
  };

  try {
    const response = await apiClient.post<DocumentChatResponseDTO>(
      `/documents/${encodeURIComponent(String(documentId))}/chat`,
      payload,
      {
        headers: {
          ...createAuthHeaders(),
        },
      }
    );

    return response.data.reply;
  } catch (error) {
    throw normalizeDocumentChatError(error);
  }
}

function normalizeParserError(error: unknown): Error {
  if (!axios.isAxiosError(error)) {
    return new Error('Không thể trích xuất nội dung lúc này. Vui lòng thử lại.');
  }

  const status = error.response?.status;
  const code = error.response?.data?.detail?.code as string | undefined;

  if (status === 413 || code === 'PARSER_FILE_TOO_LARGE' || code === 'PARSER_URL_TOO_LARGE') {
    return new Error('Dữ liệu quá lớn. Vui lòng thử với tài liệu nhỏ hơn.');
  }

  if (code === 'PARSER_URL_INVALID' || code === 'PARSER_URL_REQUIRED') {
    return new Error('Link không hợp lệ. Vui lòng nhập URL bắt đầu bằng http/https.');
  }

  if (code === 'PARSER_URL_TIMEOUT') {
    return new Error('Không thể tải link trong thời gian cho phép. Vui lòng thử lại.');
  }

  if (code === 'PARSER_URL_FETCH_FAILED' || code === 'PARSER_URL_EXTRACT_FAILED') {
    return new Error('Không thể truy cập hoặc trích xuất nội dung từ link này.');
  }

  if (code === 'PARSER_UNSUPPORTED_FORMAT' || code === 'PARSER_URL_UNSUPPORTED_CONTENT') {
    return new Error('Định dạng hiện tại chưa được hỗ trợ. Hãy dùng PDF, DOCX, JPG, PNG hoặc WEBP.');
  }

  if (code === 'PARSER_FILE_EMPTY' || code === 'PARSER_INPUT_REQUIRED') {
    return new Error('Không tìm thấy nội dung hợp lệ để trích xuất.');
  }

  if (code === 'PARSER_TEXT_EMPTY') {
    return new Error('Không trích xuất được văn bản rõ ràng từ nguồn đã chọn.');
  }

  if (code === 'LLM_TIMEOUT' || code === 'LLM_SERVICE_ERROR') {
    return new Error('Dịch vụ OCR AI tạm thời quá tải. Vui lòng thử lại sau ít phút.');
  }

  return new Error(error.response?.data?.message ?? 'Không thể trích xuất nội dung lúc này.');
}

export async function extractTextFromParser(input: ParserInput): Promise<ParserExtractResponseDTO> {
  try {
    if (input.mode === 'url') {
      const normalizedUrl = input.url.trim();
      if (!normalizedUrl) {
        throw new Error('Link không được de trong.');
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
      throw new Error('Không tìm thấy file để trích xuất.');
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
    throw new Error('Mục tiêu cần tối thiểu 3 ký tự.');
  }
  if (normalizedGoal.length > 500) {
    throw new Error('Mục tiêu tối đa 500 ký tự. Vui lòng rút gọn nội dung.');
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
      throw new Error('Mục tiêu không hợp lệ. Vui lòng nhập ít nhất 3 ký tự rõ ràng.');
    }

    if (axios.isAxiosError(error)) {
      throw new Error(error.response?.data?.message ?? 'Không thể tạo lộ trình lúc này.');
    }

    throw error;
  }
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




