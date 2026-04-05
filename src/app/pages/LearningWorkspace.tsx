import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  CheckCircle2, ChevronLeft, ChevronRight, BookOpen,
  Hammer, Rocket, Loader2, Zap, Clock,
  MessageSquare, List, CreditCard, ListChecks, Lightbulb
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import {
  completeFlashcardProgress,
  completeLessonProgress,
  generateLesson,
  getLessonDetail,
  LessonDetail,
} from '../../api/learning';
import ChatTutor from '../components/ChatTutor';
import FlashCardDeck from '../components/FlashCard';
import { Flashcard } from '../lib/types';
import { QuizResponseDTO, QuizSubmitResponseDTO } from '../../api/dto';
import { fetchQuizByLesson, submitQuiz } from '../../api/quiz';

type LearningTab = 'theory' | 'quiz' | 'flashcard';

interface QuizState {
  currentIndex: number;
  selectedAnswers: Record<string, string>;
}

function isLearningTab(value: string | null): value is LearningTab {
  return value === 'theory' || value === 'quiz' || value === 'flashcard';
}

function _stripMarkdownArtifacts(raw: string): string {
  return raw
    .replace(/^#{1,6}\s+/, '')
    .replace(/^[-*+]\s+/, '')
    .replace(/^\d+\.\s+/, '')
    .replace(/^>\s?/, '')
    .replace(/`/g, '')
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildFlashcardsFromMarkdown(markdown: string | null, maxCards: number = 12): Flashcard[] {
  if (!markdown || !markdown.trim()) {
    return [];
  }

  const lines = markdown.split('\n');
  const cards: Flashcard[] = [];
  let index = 0;

  for (let i = 0; i < lines.length && cards.length < maxCards; i += 1) {
    const current = lines[i].trim();
    if (!/^#{2,4}\s+/.test(current)) {
      continue;
    }

    const front = _stripMarkdownArtifacts(current);
    if (!front) {
      continue;
    }

    const details: string[] = [];
    let j = i + 1;
    while (j < lines.length) {
      const line = lines[j].trim();
      if (/^#{2,4}\s+/.test(line)) {
        break;
      }
      if (!line || line.startsWith('```')) {
        j += 1;
        continue;
      }
      if (line.startsWith('|') && line.endsWith('|')) {
        j += 1;
        continue;
      }

      const normalized = _stripMarkdownArtifacts(line);
      if (normalized) {
        details.push(normalized);
      }
      j += 1;
    }

    const back = details.join(' ').trim();
    if (back) {
      cards.push({
        id: `md-card-${index}`,
        front,
        back,
      });
      index += 1;
    }

    i = j - 1;
  }

  if (cards.length > 0) {
    return cards.slice(0, maxCards);
  }

  const paragraphCards = markdown
    .split(/\n{2,}/)
    .map(chunk => _stripMarkdownArtifacts(chunk))
    .filter(chunk => chunk.length > 20)
    .slice(0, maxCards)
    .map((chunk, cardIndex) => {
      const sentences = chunk.split(/(?<=[.!?])\s+/).filter(Boolean);
      const front = (sentences[0] || chunk).slice(0, 120).trim();
      const back = (sentences.slice(1).join(' ') || chunk).trim();
      return {
        id: `p-card-${cardIndex}`,
        front,
        back,
      };
    });

  return paragraphCards;
}

function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="prose prose-invert max-w-none prose-p:text-zinc-300 prose-li:text-zinc-300 prose-strong:text-violet-300 prose-headings:text-white prose-code:text-cyan-300">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h2: ({ children }) => <h2 className="text-xl text-white mt-6 mb-3" style={{ fontWeight: 700 }}>{children}</h2>,
          h3: ({ children }) => <h3 className="text-base text-zinc-200 mt-4 mb-2" style={{ fontWeight: 600 }}>{children}</h3>,
          p: ({ children }) => <p className="text-zinc-300 text-sm leading-relaxed my-2">{children}</p>,
          li: ({ children }) => <li className="text-zinc-300 text-sm my-1">{children}</li>,
          pre: ({ children }) => <pre className="overflow-x-auto rounded-xl border border-zinc-700 bg-zinc-950/80 p-3 text-xs">{children}</pre>,
          code: ({ inline, children, ...props }) => {
            if (inline) {
              return <code className="text-cyan-300 bg-cyan-400/10 px-1.5 py-0.5 rounded text-xs">{children}</code>;
            }
            return <code className="text-zinc-200" {...props}>{children}</code>;
          },
          table: ({ children }) => (
            <div className="my-4 overflow-x-auto rounded-xl border border-zinc-700 bg-zinc-900/60">
              <table className="min-w-full border-collapse text-sm text-zinc-200">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-zinc-800/80">{children}</thead>,
          th: ({ children }) => <th className="border border-zinc-700 px-3 py-2 text-left text-xs uppercase tracking-wide text-zinc-300">{children}</th>,
          td: ({ children }) => <td className="border border-zinc-800 px-3 py-2 align-top text-sm">{children}</td>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export default function LearningWorkspace() {
  const { lessonId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { roadmap, completeLesson, applyServerExp, syncServerGamification } = useApp();

  const [lessonDetail, setLessonDetail] = useState<LessonDetail | null>(null);
  const [activeTab, setActiveTab] = useState<LearningTab>('theory');
  const [isLoading, setIsLoading] = useState(true);
  const [isGeneratingContent, setIsGeneratingContent] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [showChat, setShowChat] = useState(true);
  const [showOutline, setShowOutline] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isCompleted, setIsCompleted] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [showCompletionBadge, setShowCompletionBadge] = useState(false);
  const [showCompletionModal, setShowCompletionModal] = useState(false);
  const [completionMessage, setCompletionMessage] = useState<string>('');
  const [completeError, setCompleteError] = useState<string | null>(null);

  const [quizData, setQuizData] = useState<QuizResponseDTO | null>(null);
  const [quizState, setQuizState] = useState<QuizState>({ currentIndex: 0, selectedAnswers: {} });
  const [isQuizLoading, setIsQuizLoading] = useState(false);
  const [quizLoadError, setQuizLoadError] = useState<string | null>(null);
  const [isQuizSubmitting, setIsQuizSubmitting] = useState(false);
  const [quizSubmitError, setQuizSubmitError] = useState<string | null>(null);
  const [quizResult, setQuizResult] = useState<QuizSubmitResponseDTO | null>(null);

  const [isMarkingFlashcardComplete, setIsMarkingFlashcardComplete] = useState(false);
  const [flashcardError, setFlashcardError] = useState<string | null>(null);

  // Build optional navigation metadata from in-memory roadmap context.
  const allLessons = roadmap.flatMap(w =>
    w.lessons.map(l => ({ ...l, weekTitle: w.title, weekId: w.id }))
  );
  const currentIndex = allLessons.findIndex(l => l.id === lessonId);
  const currentLesson = currentIndex >= 0 ? allLessons[currentIndex] : null;
  const prevLesson = currentIndex > 0 ? allLessons[currentIndex - 1] : null;
  const nextLesson = currentIndex < allLessons.length - 1 ? allLessons[currentIndex + 1] : null;
  const flashcards = useMemo(
    () => buildFlashcardsFromMarkdown(lessonDetail?.contentMarkdown ?? null),
    [lessonDetail?.contentMarkdown]
  );
  const quizQuestions = quizData?.questions ?? [];
  const currentQuizQuestion = quizQuestions[quizState.currentIndex];

  const lessonUrlForTab = useCallback((targetLessonId: string, targetTab: LearningTab = activeTab) => {
    if (targetTab === 'theory') {
      return `/learn/${targetLessonId}`;
    }
    return `/learn/${targetLessonId}?tab=${targetTab}`;
  }, [activeTab]);

  const setLearningTab = useCallback((tab: LearningTab) => {
    setActiveTab(tab);
    const next = new URLSearchParams(searchParams);
    if (tab === 'theory') {
      next.delete('tab');
    } else {
      next.set('tab', tab);
    }
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    const requestedTab = searchParams.get('tab');
    if (isLearningTab(requestedTab)) {
      setActiveTab(requestedTab);
      return;
    }
    setActiveTab('theory');
  }, [searchParams]);
  const youtubeEmbedUrl = lessonDetail?.youtubeVideoId
    ? `https://www.youtube.com/embed/${encodeURIComponent(lessonDetail.youtubeVideoId)}?rel=0`
    : null;

  const loadLesson = useCallback(async (targetLessonId: string) => {
    setIsLoading(true);
    setLoadError(null);
    setGenerationError(null);
    setShowCompletionModal(false);

    try {
      const detail = await getLessonDetail(targetLessonId);
      setLessonDetail(detail);
      const cachedLesson = allLessons.find(lesson => lesson.id === targetLessonId);
      setIsCompleted(detail.isCompleted || Boolean(cachedLesson?.completed));

      const missingContent = !detail.contentMarkdown || !detail.contentMarkdown.trim() || detail.isDraft;
      if (missingContent) {
        setIsGeneratingContent(true);
        try {
          const generatedDetail = await generateLesson(targetLessonId);
          setLessonDetail(generatedDetail);
        } catch (error) {
          if (axios.isAxiosError(error)) {
            setGenerationError(error.response?.data?.message ?? 'Khong the tao noi dung bai hoc luc nay.');
          } else if (error instanceof Error) {
            setGenerationError(error.message);
          } else {
            setGenerationError('Khong the tao noi dung bai hoc luc nay.');
          }
        } finally {
          setIsGeneratingContent(false);
        }
      }
    } catch (error) {
      if (axios.isAxiosError(error)) {
        setLoadError(error.response?.data?.message ?? 'Khong the tai thong tin bai hoc.');
      } else if (error instanceof Error) {
        setLoadError(error.message);
      } else {
        setLoadError('Khong the tai thong tin bai hoc.');
      }
    } finally {
      setIsLoading(false);
    }
  }, [allLessons]);

  useEffect(() => {
    if (!lessonId) return;
    setQuizData(null);
    setQuizState({ currentIndex: 0, selectedAnswers: {} });
    setIsQuizLoading(false);
    setQuizLoadError(null);
    setIsQuizSubmitting(false);
    setQuizSubmitError(null);
    setQuizResult(null);
    setIsMarkingFlashcardComplete(false);
    setFlashcardError(null);
    void loadLesson(lessonId);
  }, [lessonId, loadLesson]);

  const loadQuiz = useCallback(async (targetLessonId: string) => {
    setIsQuizLoading(true);
    setQuizLoadError(null);
    try {
      const quiz = await fetchQuizByLesson(targetLessonId);
      setQuizData(quiz);
      setQuizState({ currentIndex: 0, selectedAnswers: {} });
      setQuizResult(null);
      setQuizSubmitError(null);
    } catch (error) {
      if (axios.isAxiosError(error)) {
        setQuizLoadError(error.response?.data?.message ?? 'Khong the tai quiz luc nay.');
      } else if (error instanceof Error) {
        setQuizLoadError(error.message);
      } else {
        setQuizLoadError('Khong the tai quiz luc nay.');
      }
    } finally {
      setIsQuizLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab !== 'quiz' || !lessonId || quizData || isQuizLoading) {
      return;
    }
    void loadQuiz(lessonId);
  }, [activeTab, lessonId, quizData, isQuizLoading, loadQuiz]);

  const retryGeneration = async () => {
    if (!lessonId) return;
    setGenerationError(null);
    setIsGeneratingContent(true);
    try {
      const generatedDetail = await generateLesson(lessonId);
      setLessonDetail(generatedDetail);
    } catch (error) {
      if (axios.isAxiosError(error)) {
        setGenerationError(error.response?.data?.message ?? 'Khong the tao noi dung bai hoc luc nay.');
      } else if (error instanceof Error) {
        setGenerationError(error.message);
      } else {
        setGenerationError('Khong the tao noi dung bai hoc luc nay.');
      }
    } finally {
      setIsGeneratingContent(false);
    }
  };

  const handleSelectQuizAnswer = (optionKey: string) => {
    if (!currentQuizQuestion) {
      return;
    }

    setQuizState(prev => ({
      ...prev,
      selectedAnswers: {
        ...prev.selectedAnswers,
        [currentQuizQuestion.question_id]: optionKey,
      },
    }));
  };

  const handleSubmitQuiz = async () => {
    if (!quizData || isQuizSubmitting) {
      return;
    }

    setIsQuizSubmitting(true);
    setQuizSubmitError(null);

    try {
      const answers = Object.entries(quizState.selectedAnswers).map(([question_id, selected_option]) => ({
        question_id,
        selected_option,
      }));

      const result = await submitQuiz(quizData.quiz_id, { answers });
      const totalExpGained = (result.exp_gained ?? 0) + (result.streak_bonus_exp ?? 0);
      applyServerExp(totalExpGained);
      syncServerGamification({
        totalExp: result.total_exp,
        level: result.level,
        currentStreak: result.current_streak,
      });

      setQuizResult(result);
      if (result.is_passed) {
        setLessonDetail(prev => (prev ? { ...prev, quizPassed: true } : prev));
        setShowCompletionModal(false);
      }
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 429) {
        const retryAfter = error.response?.data?.detail?.retry_after_seconds ?? '?';
        setQuizSubmitError(`Ban da sai hoi nhieu, hay thu lai sau ${retryAfter} giay.`);
      } else if (axios.isAxiosError(error)) {
        setQuizSubmitError(error.response?.data?.message ?? 'Khong the nop quiz luc nay.');
      } else if (error instanceof Error) {
        setQuizSubmitError(error.message);
      } else {
        setQuizSubmitError('Khong the nop quiz luc nay.');
      }
    } finally {
      setIsQuizSubmitting(false);
    }
  };

  const handleNextQuizQuestion = () => {
    if (!quizData || !currentQuizQuestion) {
      return;
    }

    if (quizState.currentIndex < quizQuestions.length - 1) {
      setQuizState(prev => ({ ...prev, currentIndex: prev.currentIndex + 1 }));
      return;
    }

    void handleSubmitQuiz();
  };

  const handleRestartQuiz = () => {
    setQuizState({ currentIndex: 0, selectedAnswers: {} });
    setQuizResult(null);
    setQuizSubmitError(null);
  };

  const handleFlashcardComplete = async (_known: number, _total: number) => {
    if (!lessonId || isMarkingFlashcardComplete || lessonDetail?.flashcardCompleted) {
      return;
    }

    setIsMarkingFlashcardComplete(true);
    setFlashcardError(null);
    try {
      const result = await completeFlashcardProgress(lessonId);
      if (result.flashcard_completed) {
        setLessonDetail(prev => (prev ? { ...prev, flashcardCompleted: true } : prev));
      }
    } catch (error) {
      if (axios.isAxiosError(error)) {
        setFlashcardError(error.response?.data?.message ?? 'Khong the ghi nhan flashcard luc nay.');
      } else if (error instanceof Error) {
        setFlashcardError(error.message);
      } else {
        setFlashcardError('Khong the ghi nhan flashcard luc nay.');
      }
    } finally {
      setIsMarkingFlashcardComplete(false);
    }
  };

  const handleComplete = async () => {
    if (!lessonId || isCompleted) return;

    setIsCompleting(true);
    setCompleteError(null);
    try {
      const result = await completeLessonProgress(lessonId);
      completeLesson(lessonId);
      const totalExpGained = result.exp_gained + (result.streak_bonus_exp ?? 0);
      applyServerExp(totalExpGained);
      syncServerGamification({
        totalExp: result.total_exp,
        level: result.level,
        currentStreak: result.current_streak,
      });
      setIsCompleted(true);
      setLessonDetail(prev => (prev ? { ...prev, isCompleted: true } : prev));
      setCompletionMessage(totalExpGained > 0
        ? `+${totalExpGained} EXP · Cấp ${result.level} · Chuỗi ${result.current_streak} ngày`
        : result.message || 'Bài học đã được ghi nhận, chưa có EXP mới.');
      setShowCompletionBadge(true);
      setTimeout(() => setShowCompletionBadge(false), 3000);
      if (!(lessonDetail?.quizPassed ?? false)) {
        setShowCompletionModal(true);
      }
    } catch (error) {
      if (axios.isAxiosError(error)) {
        setCompleteError(error.response?.data?.message ?? 'Không thể hoàn thành bài học lúc này.');
      } else if (error instanceof Error) {
        setCompleteError(error.message);
      } else {
        setCompleteError('Không thể hoàn thành bài học lúc này.');
      }
    } finally {
      setIsCompleting(false);
    }
  };

  if (!lessonId) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <BookOpen size={48} className="text-zinc-700" />
        <p className="text-zinc-400">Chọn một bài học để bắt đầu</p>
        <button onClick={() => navigate('/lessons')} className="px-4 py-2 rounded-xl bg-violet-600 text-white text-sm">
          Den danh sach bai hoc
        </button>
      </div>
    );
  }

  const renderTheoryPanel = () => {
    if (!loadError && (isLoading || isGeneratingContent)) {
      return (
        <div className="space-y-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="space-y-2">
              <div className="h-4 bg-zinc-800 rounded-full animate-pulse" style={{ width: `${60 + Math.random() * 30}%` }} />
              <div className="h-3 bg-zinc-800 rounded-full animate-pulse" style={{ width: `${80 + Math.random() * 15}%` }} />
              <div className="h-3 bg-zinc-800 rounded-full animate-pulse" style={{ width: `${50 + Math.random() * 30}%` }} />
            </div>
          ))}
          <div className="flex items-center gap-3 py-4">
            <Loader2 size={20} className="text-violet-400 animate-spin" />
            <span className="text-zinc-300 text-sm" style={{ fontWeight: 600 }}>
              AI dang bien soan noi dung chi tiet cho bai hoc nay, vui long doi...
            </span>
          </div>
        </div>
      );
    }

    if (!loadError && generationError) {
      return (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-4">
          <p className="text-sm text-red-300">{generationError}</p>
          <button
            onClick={() => void retryGeneration()}
            className="mt-3 inline-flex items-center gap-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 px-3 py-2 text-xs text-zinc-100"
          >
            <Loader2 size={12} />Thu tao lai
          </button>
        </div>
      );
    }

    if (!loadError && lessonDetail?.contentMarkdown) {
      return (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8">
          {youtubeEmbedUrl ? (
            <div className="grid grid-cols-1 xl:grid-cols-5 gap-6 items-start">
              <div className="xl:col-span-2">
                <div className="rounded-2xl border border-zinc-800 bg-zinc-900 overflow-hidden">
                  <div className="px-4 py-3 border-b border-zinc-800">
                    <h3 className="text-sm text-zinc-100" style={{ fontWeight: 600 }}>Video goi y</h3>
                    <p className="text-xs text-zinc-500 mt-1">Duoc tim tu YouTube theo noi dung bai hoc</p>
                  </div>
                  <div className="aspect-video bg-black">
                    <iframe
                      src={youtubeEmbedUrl}
                      title={`YouTube video for ${lessonDetail.title}`}
                      className="w-full h-full"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                      referrerPolicy="strict-origin-when-cross-origin"
                      allowFullScreen
                    />
                  </div>
                </div>
              </div>

              <div className="xl:col-span-3">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-6 h-6 rounded-lg bg-blue-500/20 border border-blue-500/30 flex items-center justify-center">
                    <BookOpen size={13} className="text-blue-400" />
                  </div>
                  <h2 className="text-lg text-white" style={{ fontWeight: 600 }}>Noi dung bai hoc</h2>
                </div>
                <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
                  <MarkdownContent content={lessonDetail.contentMarkdown} />
                </div>
              </div>
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-6 h-6 rounded-lg bg-blue-500/20 border border-blue-500/30 flex items-center justify-center">
                  <BookOpen size={13} className="text-blue-400" />
                </div>
                <h2 className="text-lg text-white" style={{ fontWeight: 600 }}>Noi dung bai hoc</h2>
              </div>
              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
                <MarkdownContent content={lessonDetail.contentMarkdown} />
              </div>
            </div>
          )}
        </motion.div>
      );
    }

    if (!loadError) {
      return (
        <div className="rounded-2xl border border-zinc-700 bg-zinc-900 px-4 py-4">
          <p className="text-sm text-zinc-300">Noi dung bai hoc dang trong trang thai ban nhap.</p>
          <button
            onClick={() => void retryGeneration()}
            className="mt-3 inline-flex items-center gap-2 rounded-lg bg-violet-600 hover:bg-violet-500 px-3 py-2 text-xs text-white"
          >
            <Zap size={12} />Tao noi dung ngay
          </button>
        </div>
      );
    }

    return null;
  };

  const renderQuizPanel = () => {
    if (isQuizLoading) {
      return (
        <div className="rounded-2xl border border-violet-500/30 bg-violet-500/10 px-4 py-5 flex items-center gap-3">
          <Loader2 size={18} className="text-violet-300 animate-spin" />
          <p className="text-sm text-violet-200">Dang tai du lieu quiz cho bai hoc nay...</p>
        </div>
      );
    }

    if (quizLoadError) {
      return (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-4">
          <p className="text-sm text-red-300">{quizLoadError}</p>
          <button
            onClick={() => lessonId && void loadQuiz(lessonId)}
            className="mt-3 inline-flex items-center gap-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 px-3 py-2 text-xs text-zinc-100"
          >
            <Loader2 size={12} />Thu tai quiz
          </button>
        </div>
      );
    }

    if (!quizData || quizQuestions.length === 0) {
      return (
        <div className="rounded-2xl border border-zinc-700 bg-zinc-900 px-4 py-4">
          <p className="text-sm text-zinc-300">Quiz chua san sang cho bai hoc nay.</p>
          <button
            onClick={() => lessonId && void loadQuiz(lessonId)}
            className="mt-3 inline-flex items-center gap-2 rounded-lg bg-violet-600 hover:bg-violet-500 px-3 py-2 text-xs text-white"
          >
            <Zap size={12} />Tai quiz ngay
          </button>
        </div>
      );
    }

    if (quizResult) {
      const correctCount = quizResult.results.filter(item => item.is_correct).length;
      return (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6 space-y-5">
          <div className="text-center">
            <p className="text-xs uppercase tracking-wide text-zinc-500">Ket qua quiz</p>
            <p className={`text-5xl mt-2 ${quizResult.is_passed ? 'text-emerald-400' : 'text-amber-400'}`} style={{ fontWeight: 800 }}>
              {quizResult.score}%
            </p>
            <p className="text-zinc-300 text-sm mt-2">{correctCount}/{quizQuestions.length} cau dung</p>
            {quizResult.is_passed ? (
              <p className="text-emerald-300 text-sm mt-2">Ban da dat quiz. Icon Quiz se sang ngay lap tuc.</p>
            ) : (
              <p className="text-amber-300 text-sm mt-2">Chua dat nguong. Hay on lai ly thuyet va thu lai.</p>
            )}
          </div>

          {quizResult.reward_granted && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
              Chuc mung! Ban nhan {quizResult.exp_gained} EXP khi vuot quiz lan dau.
            </div>
          )}

          <div className="space-y-2">
            {quizResult.results.map((answer, index) => (
              <div key={answer.question_id} className="space-y-2">
                <div
                  className={`rounded-lg border px-3 py-2 text-sm ${answer.is_correct ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100' : 'border-red-500/30 bg-red-500/10 text-red-100'}`}
                >
                  Cau {index + 1}: {answer.is_correct ? 'Dung' : 'Sai'}
                </div>
                {!answer.is_correct && answer.explanation && (
                  <div className="rounded-lg border border-amber-400/35 bg-amber-400/10 px-3 py-2.5 text-amber-100">
                    <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-amber-300" style={{ fontWeight: 700 }}>
                      <Lightbulb size={13} />Giai thich
                    </div>
                    <p className="mt-1.5 text-sm leading-relaxed text-amber-100/95">{answer.explanation}</p>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleRestartQuiz}
              className="flex-1 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-100 px-4 py-2.5 text-sm"
              style={{ fontWeight: 600 }}
            >
              Lam lai quiz
            </button>
            <button
              onClick={() => setLearningTab('theory')}
              className="flex-1 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white px-4 py-2.5 text-sm"
              style={{ fontWeight: 600 }}
            >
              Quay lai ly thuyet
            </button>
          </div>
        </div>
      );
    }

    const selectedKey = currentQuizQuestion ? quizState.selectedAnswers[currentQuizQuestion.question_id] : undefined;

    return (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6 space-y-5">
        <div className="flex items-center justify-between">
          <p className="text-sm text-zinc-400">Cau {quizState.currentIndex + 1}/{quizQuestions.length}</p>
          <p className="text-xs text-cyan-300">Da chon {Object.keys(quizState.selectedAnswers).length} dap an</p>
        </div>

        <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
          <motion.div
            animate={{ width: `${quizQuestions.length > 0 ? (quizState.currentIndex / quizQuestions.length) * 100 : 0}%` }}
            className="h-full bg-cyan-500 rounded-full"
          />
        </div>

        <div className="rounded-xl border border-zinc-700 bg-zinc-950/60 p-4">
          <h3 className="text-lg text-white" style={{ fontWeight: 600 }}>{currentQuizQuestion?.text}</h3>
        </div>

        <div className="space-y-3">
          {currentQuizQuestion?.options.map(option => {
            const isSelected = selectedKey === option.option_key;
            return (
              <button
                key={option.option_key}
                onClick={() => handleSelectQuizAnswer(option.option_key)}
                className={`w-full text-left rounded-xl border px-4 py-3 text-sm transition-colors ${!selectedKey ? 'border-zinc-700 bg-zinc-900 hover:border-zinc-500 hover:bg-zinc-800 text-zinc-200' : isSelected ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-100' : 'border-zinc-800 bg-zinc-900 text-zinc-500'}`}
              >
                <span className="inline-flex items-center gap-2">
                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-full border border-current text-xs" style={{ fontWeight: 600 }}>
                    {option.option_key}
                  </span>
                  {option.text}
                </span>
              </button>
            );
          })}
        </div>

        <button
          onClick={handleNextQuizQuestion}
          disabled={!selectedKey || isQuizSubmitting}
          className="w-full rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-60 disabled:cursor-not-allowed text-white px-4 py-2.5 text-sm"
          style={{ fontWeight: 600 }}
        >
          {quizState.currentIndex < quizQuestions.length - 1
            ? 'Cau tiep theo'
            : (isQuizSubmitting ? 'Dang nop quiz...' : 'Nop quiz')}
        </button>

        {quizSubmitError && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {quizSubmitError}
          </div>
        )}
      </div>
    );
  };

  const renderFlashcardPanel = () => {
    if (!lessonDetail?.contentMarkdown && (isLoading || isGeneratingContent)) {
      return (
        <div className="rounded-2xl border border-violet-500/30 bg-violet-500/10 px-4 py-5 flex items-center gap-3">
          <Loader2 size={18} className="text-violet-300 animate-spin" />
          <p className="text-sm text-violet-200">Dang chuan bi noi dung de tao flashcard...</p>
        </div>
      );
    }

    if (flashcards.length === 0) {
      return (
        <div className="rounded-2xl border border-zinc-700 bg-zinc-900 px-4 py-4">
          <p className="text-sm text-zinc-300">Chua du thong tin de tao flashcard. Hay tao noi dung ly thuyet truoc.</p>
          <button
            onClick={() => setLearningTab('theory')}
            className="mt-3 inline-flex items-center gap-2 rounded-lg bg-violet-600 hover:bg-violet-500 px-3 py-2 text-xs text-white"
          >
            <BookOpen size={12} />Den tab Ly thuyet
          </button>
        </div>
      );
    }

    return (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 sm:p-6">
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span className="text-xs text-zinc-500">Tong {flashcards.length} the</span>
          {lessonDetail?.flashcardCompleted && (
            <span className="text-xs rounded-full px-2.5 py-1 border border-cyan-500/40 bg-cyan-500/15 text-cyan-300">
              Flashcard da hoan thanh
            </span>
          )}
          {isMarkingFlashcardComplete && (
            <span className="text-xs rounded-full px-2.5 py-1 border border-violet-500/40 bg-violet-500/15 text-violet-300 inline-flex items-center gap-1.5">
              <Loader2 size={12} className="animate-spin" />Dang ghi nhan
            </span>
          )}
        </div>

        <FlashCardDeck
          cards={flashcards}
          onComplete={(known, total) => {
            void handleFlashcardComplete(known, total);
          }}
        />

        {flashcardError && (
          <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {flashcardError}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex h-full">
      {/* Lesson outline sidebar */}
      <AnimatePresence>
        {showOutline && (
          <motion.aside
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 260, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            className="flex-shrink-0 bg-zinc-900 border-r border-zinc-800 overflow-y-auto"
          >
            <div className="p-4">
              <h3 className="text-sm text-white mb-3" style={{ fontWeight: 600 }}>Danh sách bài học</h3>
              {roadmap.length === 0 ? (
                <p className="text-xs text-zinc-500 leading-relaxed">
                  Khong co du lieu outline trong phien hien tai. Ban van co the hoc bai bang noi dung duoc tai tu server.
                </p>
              ) : (
                roadmap.map(week => (
                  <div key={week.id} className="mb-4">
                    <p className="text-xs text-zinc-500 mb-2 uppercase tracking-wider" style={{ fontWeight: 600 }}>Tuần {week.weekNumber}: {week.title}</p>
                    {week.lessons.map(lesson => (
                      <button
                        key={lesson.id}
                        onClick={() => navigate(lessonUrlForTab(lesson.id, activeTab))}
                        className={`w-full flex items-center gap-2 text-left px-3 py-2 rounded-lg mb-1 text-sm transition-colors ${
                          lesson.id === lessonId
                            ? 'bg-violet-500/20 text-violet-300 border border-violet-500/30'
                            : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
                        }`}
                      >
                        {lesson.completed ? (
                          <CheckCircle2 size={14} className="text-emerald-400 flex-shrink-0" />
                        ) : (
                          <div className="w-3.5 h-3.5 rounded-full border border-zinc-600 flex-shrink-0" />
                        )}
                        <span className="truncate">{lesson.title}</span>
                      </button>
                    ))}
                  </div>
                ))
              )}
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Main content */}
      <div className={`flex-1 flex overflow-hidden ${showChat ? '' : ''}`}>
        {/* Lesson content */}
        <div className="flex-1 overflow-y-auto">
          {/* Top bar */}
          <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-3 bg-zinc-950/90 backdrop-blur-sm border-b border-zinc-800">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowOutline(!showOutline)}
                className={`p-2 rounded-lg transition-colors ${showOutline ? 'bg-zinc-800 text-zinc-300' : 'text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800'}`}
                title="Danh sách bài học"
              >
                <List size={16} />
              </button>
              <div className="text-xs text-zinc-500">
                <span className="text-violet-400">
                  {lessonDetail ? `Tuan ${lessonDetail.weekNumber}` : (currentLesson?.weekTitle ?? 'Bai hoc')}
                </span>
                <span className="mx-1">›</span>
                <span>{lessonDetail?.title ?? currentLesson?.title ?? 'Dang tai...'}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {currentLesson && (
                <>
                  <div className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-full ${
                    currentLesson.type === 'theory' ? 'bg-blue-500/20 text-blue-400' :
                    currentLesson.type === 'practice' ? 'bg-emerald-500/20 text-emerald-400' :
                    'bg-orange-500/20 text-orange-400'
                  }`}>
                    {currentLesson.type === 'theory' ? <BookOpen size={11} /> : currentLesson.type === 'practice' ? <Hammer size={11} /> : <Rocket size={11} />}
                    {currentLesson.type === 'theory' ? 'Ly thuyet' : currentLesson.type === 'practice' ? 'Thuc hanh' : 'Du an'}
                  </div>
                  <div className="flex items-center gap-1 text-xs text-zinc-500">
                    <Clock size={12} />{currentLesson.duration}
                  </div>
                </>
              )}
              <button
                onClick={() => setShowChat(!showChat)}
                className={`p-2 rounded-lg transition-colors ${showChat ? 'bg-violet-500/20 text-violet-400 border border-violet-500/30' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'}`}
                title="AI Tutor"
              >
                <MessageSquare size={16} />
              </button>
            </div>
          </div>

          <div className="max-w-3xl mx-auto px-6 py-8 space-y-8">
            {/* Lesson title */}
            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
              <h1 className="text-3xl text-white" style={{ fontWeight: 700 }}>
                {lessonDetail?.title ?? currentLesson?.title ?? 'Bai hoc'}
              </h1>
              <p className="text-zinc-500 text-sm mt-1">
                {lessonDetail
                  ? `Lo trinh: ${lessonDetail.roadmapTitle}`
                  : (currentLesson?.description ?? 'Dang tai thong tin bai hoc...')}
              </p>
            </motion.div>

            {loadError && (
              <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3">
                <p className="text-sm text-red-300">{loadError}</p>
                <button
                  onClick={() => lessonId && void loadLesson(lessonId)}
                  className="mt-3 inline-flex items-center gap-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 px-3 py-2 text-xs text-zinc-100"
                >
                  <Loader2 size={12} />Thu tai lai
                </button>
              </div>
            )}

              {!loadError && lessonDetail && (
                <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-1.5 sm:p-2 grid grid-cols-3 gap-1.5">
                  <button
                    onClick={() => setLearningTab('theory')}
                    className={`rounded-xl px-3 py-2.5 text-sm flex items-center justify-center gap-2 transition-colors ${activeTab === 'theory' ? 'bg-violet-600 text-white' : 'text-zinc-300 hover:bg-zinc-800'}`}
                    style={{ fontWeight: 600 }}
                  >
                    <BookOpen size={15} />Ly thuyet
                  </button>
                  <button
                    onClick={() => setLearningTab('quiz')}
                    className={`rounded-xl px-3 py-2.5 text-sm flex items-center justify-center gap-2 transition-colors ${activeTab === 'quiz' ? 'bg-cyan-600 text-white' : lessonDetail.quizPassed ? 'text-emerald-300 hover:bg-emerald-500/10' : 'text-zinc-300 hover:bg-zinc-800'}`}
                    style={{ fontWeight: 600 }}
                  >
                    <ListChecks size={15} />Quiz
                    {lessonDetail.quizPassed && <CheckCircle2 size={14} className="text-emerald-300" />}
                  </button>
                  <button
                    onClick={() => setLearningTab('flashcard')}
                    className={`rounded-xl px-3 py-2.5 text-sm flex items-center justify-center gap-2 transition-colors ${activeTab === 'flashcard' ? 'bg-indigo-600 text-white' : lessonDetail.flashcardCompleted ? 'text-cyan-300 hover:bg-cyan-500/10' : 'text-zinc-300 hover:bg-zinc-800'}`}
                    style={{ fontWeight: 600 }}
                  >
                    <CreditCard size={15} />Flashcard
                    {lessonDetail.flashcardCompleted && <CheckCircle2 size={14} className="text-cyan-300" />}
                  </button>
                </div>
              )}

              {!loadError && activeTab === 'theory' && renderTheoryPanel()}
              {!loadError && activeTab === 'quiz' && renderQuizPanel()}
              {!loadError && activeTab === 'flashcard' && renderFlashcardPanel()}
          </div>

          {/* Navigation & Complete */}
          <div className="sticky bottom-0 bg-zinc-950/95 backdrop-blur-sm border-t border-zinc-800 px-6 py-4">
            <div className="max-w-3xl mx-auto flex items-center justify-between gap-4">
              <button
                onClick={() => prevLesson && navigate(lessonUrlForTab(prevLesson.id, activeTab))}
                disabled={!prevLesson}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm text-zinc-400 bg-zinc-900 border border-zinc-800 hover:border-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              >
                <ChevronLeft size={16} />Bài trước
              </button>

              <button
                onClick={handleComplete}
                disabled={isCompleted || isCompleting}
                className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm transition-all ${
                  isCompleted
                    ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 cursor-default'
                    : 'bg-violet-600 hover:bg-violet-500 text-white'
                }`}
                style={{ fontWeight: 600 }}
              >
                {isCompleted ? (
                  <><CheckCircle2 size={16} />Đã hoàn thành</>
                ) : (
                  <><Zap size={16} />{isCompleting ? 'Đang ghi nhận...' : 'Hoàn thành bài học'}</>
                )}
              </button>

              <button
                onClick={() => nextLesson && navigate(lessonUrlForTab(nextLesson.id, activeTab))}
                disabled={!nextLesson}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm text-zinc-400 bg-zinc-900 border border-zinc-800 hover:border-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              >
                Bài sau<ChevronRight size={16} />
              </button>
            </div>
            {completeError && (
              <div className="max-w-3xl mx-auto mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
                {completeError}
              </div>
            )}
          </div>
        </div>

        {/* AI Chat */}
        <AnimatePresence>
          {showChat && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 360, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="flex-shrink-0 border-l border-zinc-800 p-4 overflow-hidden"
            >
              <ChatTutor />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Completion badge */}
      <AnimatePresence>
        {showCompletionBadge && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 50, scale: 0.9 }}
            className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-zinc-900 border border-emerald-500/50 rounded-2xl px-6 py-4 flex items-center gap-3 shadow-xl shadow-emerald-500/20 z-50"
          >
            <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center">
              <CheckCircle2 size={22} className="text-emerald-400" />
            </div>
            <div>
              <p className="text-white text-sm" style={{ fontWeight: 700 }}>Bài học hoàn thành! 🎉</p>
              <p className="text-emerald-400 text-xs">{completionMessage}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showCompletionModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.96 }}
              className="w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-900 p-6"
            >
              <div className="w-12 h-12 rounded-xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center mb-4">
                <ListChecks size={22} className="text-cyan-300" />
              </div>
              <h3 className="text-xl text-white" style={{ fontWeight: 700 }}>Hoan thanh bai hoc roi, lam quiz tiep nhe?</h3>
              <p className="text-sm text-zinc-400 mt-2">
                Vuot quiz de nhan them EXP va bat icon Quiz Passed cho bai hoc nay.
              </p>

              <div className="mt-6 grid grid-cols-2 gap-3">
                <button
                  onClick={() => setShowCompletionModal(false)}
                  className="rounded-xl px-4 py-2.5 text-sm bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
                  style={{ fontWeight: 600 }}
                >
                  De sau
                </button>
                <button
                  onClick={() => {
                    setShowCompletionModal(false);
                    setLearningTab('quiz');
                  }}
                  className="rounded-xl px-4 py-2.5 text-sm bg-cyan-600 hover:bg-cyan-500 text-white"
                  style={{ fontWeight: 600 }}
                >
                  Lam ngay
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
