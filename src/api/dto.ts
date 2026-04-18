export interface LessonDTO {
  id: string;
  title: string;
  duration: string;
  completed: boolean;
  type: 'theory' | 'practice' | 'project';
  description: string;
  youtube_video_id?: string | null;
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
  current_streak?: number;
  total_study_days?: number;
}

export interface ActivityDayDTO {
  date: string;
  count: number;
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

export interface DocumentCreateRequestDTO {
  title: string;
  source_content: string;
}

export interface DocumentCreateResponseDTO {
  document_id: number;
  title: string;
  message: string;
}

export interface DocumentUploadResponseDTO {
  document_id: number;
  title: string;
  message: string;
  source_file_url?: string | null;
  source_file_name?: string | null;
}

export interface DocumentRenameRequestDTO {
  title: string;
}

export interface DocumentSummaryDTO {
  id: number;
  title: string;
  is_completed: boolean;
  quiz_passed: boolean;
  flashcard_completed: boolean;
  created_at: string;
}

export interface DocumentPageDTO {
  items: DocumentSummaryDTO[];
  page: number;
  page_size: number;
  total_items: number;
  total_pages: number;
}

export interface DocumentDeleteResponseDTO {
  document_id: number;
  message: string;
}

export interface DocumentChatHistoryItemDTO {
  role: 'user' | 'assistant';
  content: string;
}

export interface DocumentChatRequestDTO {
  message: string;
  history: DocumentChatHistoryItemDTO[];
}

export interface DocumentChatResponseDTO {
  reply: string;
}

export interface ParserExtractUrlRequestDTO {
  url: string;
}

export interface ParserExtractResponseDTO {
  extracted_text: string;
  source_type: 'url' | 'pdf' | 'docx' | 'image';
  extracted_title?: string | null;
  mime_type?: string | null;
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
  quiz_passed: boolean;
  flashcard_completed: boolean;
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
}

export interface QuizOptionDTO {
  option_key: string;
  text: string;
}

export interface QuizPublicQuestionDTO {
  question_id: string;
  text: string;
  options: QuizOptionDTO[];
  type?: 'theory' | 'fill_code' | 'find_bug' | 'general_choice' | 'fill_blank' | 'english' | null;
  difficulty?: 'Easy' | 'Medium' | 'Hard' | null;
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
  exp_gained: number;
  streak_bonus_exp: number;
  total_exp: number;
  level: number;
  current_streak: number;
  reward_granted: boolean;
  message: string;
  results: QuizSubmitResultDTO[];
  selected_answers?: Record<string, string>;
}

export interface QuizAttemptSnapshotDTO extends QuizSubmitResponseDTO {
  selected_answers: Record<string, string>;
  submitted_at: string;
}

// Security contract: never include correct_answer or explanation in quiz fetch payload.
export interface QuizResponseDTO {
  quiz_id: string;
  lesson_id: string;
  questions: QuizPublicQuestionDTO[];
  attempt?: QuizAttemptSnapshotDTO | null;
}

export interface DocumentQuizSubmitRequestDTO {
  selected_answers: Record<string, string>;
}

export interface LessonCompleteResponseDTO {
  lesson_id: number;
  exp_gained: number;
  streak_bonus_exp: number;
  total_exp: number;
  level: number;
  current_streak: number;
  already_completed: boolean;
  message: string;
}

export interface FlashcardCompleteResponseDTO {
  lesson_id: number;
  flashcard_completed: boolean;
  already_completed: boolean;
  message: string;
}

export type FlashcardStatusDTO = 'new' | 'got_it' | 'missed_it';

export interface FlashcardDTO {
  id: number;
  document_id: number;
  front_text: string;
  back_text: string;
  status: FlashcardStatusDTO;
  created_at: string;
  updated_at: string;
}

export interface FlashcardStatusUpdateRequestDTO {
  status: Extract<FlashcardStatusDTO, 'got_it' | 'missed_it'>;
}

export interface FlashcardExplainResponseDTO {
  explanation: string;
}

export interface LessonDetailDTO {
  id: number;
  title: string;
  week_number: number;
  position: number;
  roadmap_id?: number | null;
  roadmap_title?: string | null;
  is_completed: boolean;
  quiz_passed: boolean;
  flashcard_completed: boolean;
  source_content?: string | null;
  source_file_url?: string | null;
  source_file_name?: string | null;
  source_file_mime_type?: string | null;
  content_markdown?: string | null;
  youtube_video_id?: string | null;
  is_draft: boolean;
}

export interface LessonGenerateResponseDTO {
  lesson: LessonDetailDTO;
}

export interface ChatMessageDTO {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatRequestDTO {
  messages: ChatMessageDTO[];
}

export interface ChatResponseDTO {
  reply: string;
}

export interface ChatHistoryMessageDTO {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}
