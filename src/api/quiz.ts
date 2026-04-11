import { apiClient, createAuthHeaders } from './client';
import {
  DocumentQuizSubmitRequestDTO,
  QuizResponseDTO,
  QuizSubmitRequestDTO,
  QuizSubmitResponseDTO,
} from './dto';

export async function fetchQuizByDocument(documentId: string | number): Promise<QuizResponseDTO> {
  const response = await apiClient.get<QuizResponseDTO>(`/documents/${encodeURIComponent(String(documentId))}/quiz`, {
    headers: {
      ...createAuthHeaders(),
    },
  });
  return response.data;
}

export async function generateQuizByDocument(documentId: string | number): Promise<QuizResponseDTO> {
  const response = await apiClient.post<QuizResponseDTO>(
    `/documents/${encodeURIComponent(String(documentId))}/quiz/generate`,
    {},
    {
      headers: {
        ...createAuthHeaders(),
      },
    }
  );

  return response.data;
}

export async function fetchQuizByLesson(lessonId: string): Promise<QuizResponseDTO> {
  return fetchQuizByDocument(lessonId);
}

export async function generateQuizByLesson(lessonId: string): Promise<QuizResponseDTO> {
  return generateQuizByDocument(lessonId);
}

export async function submitQuiz(quizId: string, payload: QuizSubmitRequestDTO): Promise<QuizSubmitResponseDTO> {
  const response = await apiClient.post<QuizSubmitResponseDTO>(`/quizzes/${quizId}/submit`, payload, {
    headers: {
      ...createAuthHeaders(),
    },
  });
  return response.data;
}

export async function submitQuizByDocument(
  documentId: string | number,
  payload: DocumentQuizSubmitRequestDTO,
): Promise<QuizSubmitResponseDTO> {
  const response = await apiClient.post<QuizSubmitResponseDTO>(
    `/documents/${encodeURIComponent(String(documentId))}/quiz/submit`,
    payload,
    {
      headers: {
        ...createAuthHeaders(),
      },
    }
  );

  return response.data;
}
