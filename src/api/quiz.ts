import { apiClient } from './client';
import {
  QuizResponseDTO,
  QuizSubmitRequestDTO,
  QuizSubmitResponseDTO,
} from './dto';

export async function fetchQuizByLesson(lessonId: string): Promise<QuizResponseDTO> {
  const response = await apiClient.get<QuizResponseDTO>(`/lessons/${lessonId}/quiz`);
  return response.data;
}

export async function submitQuiz(payload: QuizSubmitRequestDTO): Promise<QuizSubmitResponseDTO> {
  const response = await apiClient.post<QuizSubmitResponseDTO>('/quizzes/submit', payload);
  return response.data;
}
