import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { motion, AnimatePresence } from 'motion/react';
import { useParams, useNavigate } from 'react-router';
import {
  CheckCircle2, ChevronLeft, ChevronRight, BookOpen,
  Hammer, Rocket, Loader2, Zap, Clock,
  MessageSquare, List
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { completeLessonProgress, generateLesson, getLessonDetail, LessonDetail } from '../../api/learning';
import ChatTutor from '../components/ChatTutor';

function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="prose prose-invert max-w-none">
      {content.split('\n').map((line, i) => {
        if (line.startsWith('## ')) return <h2 key={i} className="text-xl text-white mt-6 mb-3" style={{ fontWeight: 700 }}>{line.slice(3)}</h2>;
        if (line.startsWith('### ')) return <h3 key={i} className="text-base text-zinc-200 mt-4 mb-2" style={{ fontWeight: 600 }}>{line.slice(4)}</h3>;
        if (line.startsWith('**') && line.endsWith('**')) return <p key={i} className="text-zinc-200 my-1" style={{ fontWeight: 600 }}>{line.slice(2, -2)}</p>;
        if (line.startsWith('- ')) return <li key={i} className="text-zinc-300 text-sm my-1 ml-4 list-disc">{formatInline(line.slice(2))}</li>;
        if (line === '') return <div key={i} className="h-2" />;
        return <p key={i} className="text-zinc-300 text-sm leading-relaxed">{formatInline(line)}</p>;
      })}
    </div>
  );
}

function formatInline(text: string) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={i} className="text-cyan-400 bg-cyan-400/10 px-1.5 py-0.5 rounded text-xs font-mono">{part.slice(1, -1)}</code>;
    }
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="text-violet-300">{part.slice(2, -2)}</strong>;
    }
    return <span key={i}>{part}</span>;
  });
}

export default function LearningWorkspace() {
  const { lessonId } = useParams();
  const navigate = useNavigate();
  const { roadmap, completeLesson, applyServerExp, syncServerGamification } = useApp();

  const [lessonDetail, setLessonDetail] = useState<LessonDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isGeneratingContent, setIsGeneratingContent] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [showChat, setShowChat] = useState(true);
  const [showOutline, setShowOutline] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isCompleted, setIsCompleted] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [showCompletionBadge, setShowCompletionBadge] = useState(false);
  const [completionMessage, setCompletionMessage] = useState<string>('');
  const [completeError, setCompleteError] = useState<string | null>(null);

  // Build optional navigation metadata from in-memory roadmap context.
  const allLessons = roadmap.flatMap(w =>
    w.lessons.map(l => ({ ...l, weekTitle: w.title, weekId: w.id }))
  );
  const currentIndex = allLessons.findIndex(l => l.id === lessonId);
  const currentLesson = currentIndex >= 0 ? allLessons[currentIndex] : null;
  const prevLesson = currentIndex > 0 ? allLessons[currentIndex - 1] : null;
  const nextLesson = currentIndex < allLessons.length - 1 ? allLessons[currentIndex + 1] : null;
  const youtubeEmbedUrl = lessonDetail?.youtubeVideoId
    ? `https://www.youtube.com/embed/${encodeURIComponent(lessonDetail.youtubeVideoId)}?rel=0`
    : null;

  const loadLesson = async (targetLessonId: string) => {
    setIsLoading(true);
    setLoadError(null);
    setGenerationError(null);

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
  };

  useEffect(() => {
    if (!lessonId) return;
    void loadLesson(lessonId);
  }, [lessonId]);

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
                        onClick={() => navigate(`/learn/${lesson.id}`)}
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

            {!loadError && (isLoading || isGeneratingContent) ? (
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
            ) : !loadError && generationError ? (
              <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-4">
                <p className="text-sm text-red-300">{generationError}</p>
                <button
                  onClick={() => void retryGeneration()}
                  className="mt-3 inline-flex items-center gap-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 px-3 py-2 text-xs text-zinc-100"
                >
                  <Loader2 size={12} />Thu tao lai
                </button>
              </div>
            ) : !loadError && lessonDetail?.contentMarkdown ? (
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
            ) : !loadError ? (
              <div className="rounded-2xl border border-zinc-700 bg-zinc-900 px-4 py-4">
                <p className="text-sm text-zinc-300">Noi dung bai hoc dang trong trang thai ban nhap.</p>
                <button
                  onClick={() => void retryGeneration()}
                  className="mt-3 inline-flex items-center gap-2 rounded-lg bg-violet-600 hover:bg-violet-500 px-3 py-2 text-xs text-white"
                >
                  <Zap size={12} />Tao noi dung ngay
                </button>
              </div>
            ) : null}
          </div>

          {/* Navigation & Complete */}
          <div className="sticky bottom-0 bg-zinc-950/95 backdrop-blur-sm border-t border-zinc-800 px-6 py-4">
            <div className="max-w-3xl mx-auto flex items-center justify-between gap-4">
              <button
                onClick={() => prevLesson && navigate(`/learn/${prevLesson.id}`)}
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
                onClick={() => nextLesson && navigate(`/learn/${nextLesson.id}`)}
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
    </div>
  );
}