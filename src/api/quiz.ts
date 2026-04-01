import axios from 'axios';
import { apiClient, createAuthHeaders } from './client';
import {
  QuizResponseDTO,
  QuizSubmitRequestDTO,
  QuizSubmitResponseDTO,
} from './dto';

export async function fetchQuizByLesson(lessonId: string): Promise<QuizResponseDTO> {
  try {
    const response = await apiClient.get<QuizResponseDTO>(`/lessons/${lessonId}/quiz`, {
      headers: {
        ...createAuthHeaders(),
      },
    });
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      return generateQuizByLesson(lessonId);
    }
    throw error;
  }
}

export async function generateQuizByLesson(lessonId: string): Promise<QuizResponseDTO> {
  const response = await apiClient.post<QuizResponseDTO>(
    `/lessons/${lessonId}/quiz/generate`,
    {},
    {
      headers: {
        ...createAuthHeaders(),
      },
    }
  );

  return response.data;
}

export async function submitQuiz(quizId: string, payload: QuizSubmitRequestDTO): Promise<QuizSubmitResponseDTO> {
  const response = await apiClient.post<QuizSubmitResponseDTO>(`/quizzes/${quizId}/submit`, payload, {
    headers: {
      ...createAuthHeaders(),
    },
  });
  return response.data;
}
