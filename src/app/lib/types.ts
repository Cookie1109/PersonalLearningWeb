import {
  LessonContentDTO,
  LessonDTO,
  QuizPublicQuestionDTO,
  QuizResponseDTO,
  QuizSubmitResponseDTO,
  WeekModuleDTO,
} from '../../api/dto';

export interface Lesson {
  id: LessonDTO['id'];
  title: LessonDTO['title'];
  duration: LessonDTO['duration'];
  completed: LessonDTO['completed'];
  type: LessonDTO['type'];
  description: LessonDTO['description'];
}

export interface WeekModule {
  id: WeekModuleDTO['id'];
  weekNumber: WeekModuleDTO['week_number'];
  title: WeekModuleDTO['title'];
  description: WeekModuleDTO['description'];
  lessons: Lesson[];
  completed: WeekModuleDTO['completed'];
  expanded: WeekModuleDTO['expanded'];
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export interface QuizQuestion {
  id: QuizPublicQuestionDTO['question_id'];
  question: QuizPublicQuestionDTO['text'];
  options: QuizPublicQuestionDTO['options'];
  correctIndex?: number;
  explanation?: string;
}

export interface Flashcard {
  id: string;
  front: string;
  back: string;
}

export interface LessonContent {
  title: LessonContentDTO['title'];
  theory: LessonContentDTO['theory'];
  examples: { title: string; code?: string; description: string }[];
  keyPoints: string[];
}

export type QuizPayload = QuizResponseDTO;
export type QuizSubmissionResult = QuizSubmitResponseDTO;

export interface ActivityDay {
  date: string;
  count: number;
}

export interface UserStats {
  name: string;
  email: string;
  avatarUrl: string | null;
  level: number;
  exp: number;
  expToNextLevel: number;
  streak: number;
  totalLessons: number;
  totalDays: number;
}
