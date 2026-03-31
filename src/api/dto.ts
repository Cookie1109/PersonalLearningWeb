export interface LessonDTO {
  id: string;
  title: string;
  duration: string;
  completed: boolean;
  type: 'theory' | 'practice' | 'project';
  description: string;
}

export interface LoginRequestDTO {
  email: string;
  password: string;
  device_id?: string;
}

export interface RegisterRequestDTO {
  email: string;
  password: string;
  display_name?: string;
}

export interface UserProfileDTO {
  user_id: number;
  email: string;
  display_name: string;
  level: number;
  total_exp: number;
}

export interface LoginResponseDTO {
  access_token: string;
  token_type: string;
  expires_in: number;
  user: UserProfileDTO;
}

export interface RegisterResponseDTO {
  user_id: number;
  email: string;
  display_name: string;
  level: number;
  total_exp: number;
}

export interface LogoutRequestDTO {
  revoke_all_devices: boolean;
}

export interface GenericStatusDTO {
  status: string;
  message: string;
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

export interface RoadmapLessonItemDTO {
  id: number;
  title: string;
  is_completed: boolean;
}

export interface RoadmapWeekItemDTO {
  week_number: number;
  title: string;
  lessons: RoadmapLessonItemDTO[];
}

export interface RoadmapItemDTO {
  roadmap_id: number;
  goal: string;
  title: string;
  weeks: RoadmapWeekItemDTO[];
}

export interface RoadmapMeResponseDTO {
  roadmaps: RoadmapItemDTO[];
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

export interface QuizSubmitAnswerDTO {
  question_id: string;
  selected_option: string;
}

export interface QuizSubmitRequestDTO {
  answers: QuizSubmitAnswerDTO[];
}

export interface QuizSubmitResultDTO {
  question_id: string;
  is_correct: boolean;
  selected_option?: string | null;
  correct_answer?: string | null;
  explanation?: string | null;
}

export interface QuizSubmitResponseDTO {
  score: number;
  is_passed: boolean;
  exp_earned: number;
  first_pass_awarded: boolean;
  wrong_question_ids: string[];
  results?: QuizSubmitResultDTO[] | null;
}

export interface LessonCompleteResponseDTO {
  lesson_id: number;
  exp_earned: number;
  total_exp: number;
  already_completed: boolean;
  message: string;
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
