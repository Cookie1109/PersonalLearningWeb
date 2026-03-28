export interface LessonDTO {
  id: string;
  title: string;
  duration: string;
  completed: boolean;
  type: 'theory' | 'practice' | 'project';
  description: string;
}

export interface WeekModuleDTO {
  id: string;
  week_number: number;
  title: string;
  description: string;
  lessons: LessonDTO[];
  completed: boolean;
  expanded: boolean;
}

export interface RoadmapGenerateRequestDTO {
  goal: string;
}

export interface RoadmapGenerateResponseDTO {
  weeks: WeekModuleDTO[];
}

export interface LessonExampleDTO {
  title: string;
  description: string;
  code?: string | null;
}

export interface LessonContentDTO {
  title: string;
  theory: string;
  examples: LessonExampleDTO[];
  key_points: string[];
  youtube_query: string;
}

export interface YouTubeVideoDTO {
  id: string;
  title: string;
  channel: string;
  thumbnail: string;
  duration: string;
  views: string;
  url: string;
}

export interface QuizOptionDTO {
  option_key: string;
  text: string;
}

export interface QuizPublicQuestionDTO {
  question_id: string;
  text: string;
  options: QuizOptionDTO[];
}

// Security contract: never include correct_answer or explanation in quiz fetch payload.
export interface QuizResponseDTO {
  quiz_id: string;
  lesson_id: string;
  questions: QuizPublicQuestionDTO[];
}

export interface QuizSubmitRequestDTO {
  quiz_id: string;
  lesson_id: string;
  user_answers: Record<string, string>;
}

export interface QuizSubmitResultDTO {
  question_id: string;
  is_correct: boolean;
  selected_option: string;
  correct_answer?: string | null;
  explanation?: string | null;
}

export interface QuizSubmitResponseDTO {
  score: number;
  is_passed: boolean;
  wrong_question_ids: string[];
  results?: QuizSubmitResultDTO[] | null;
}

export interface ChatMessageDTO {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface ChatRequestDTO {
  message: string;
  history: ChatMessageDTO[];
}

export interface ChatResponseDTO {
  reply: string;
}
