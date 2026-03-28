import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useParams, useNavigate } from 'react-router';
import {
  CheckCircle2, ChevronLeft, ChevronRight, BookOpen,
  Hammer, Rocket, Loader2, Play, ExternalLink, Youtube,
  Code2, Lightbulb, ChevronDown, ChevronUp, Zap, Clock,
  MessageSquare, List
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { generateLessonContent, searchYouTube } from '../../api/learning';
import { YouTubeVideoDTO } from '../../api/dto';
import { LessonContent } from '../lib/types';
import ChatTutor from '../components/ChatTutor';

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="relative group rounded-xl overflow-hidden border border-zinc-700">
      <div className="flex items-center justify-between px-4 py-2 bg-zinc-800 border-b border-zinc-700">
        <div className="flex gap-1.5">
          <div className="w-3 h-3 rounded-full bg-red-500/70" />
          <div className="w-3 h-3 rounded-full bg-yellow-500/70" />
          <div className="w-3 h-3 rounded-full bg-emerald-500/70" />
        </div>
        <span className="text-xs text-zinc-500">Python</span>
        <button onClick={copy} className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors px-2 py-0.5 rounded bg-zinc-700 hover:bg-zinc-600">
          {copied ? '✓ Đã copy' : 'Copy'}
        </button>
      </div>
      <pre className="p-4 bg-zinc-950 text-sm text-zinc-300 overflow-x-auto leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

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
  const { roadmap, completeLesson, addExpAndStreak } = useApp();

  const [content, setContent] = useState<LessonContent | null>(null);
  const [videos, setVideos] = useState<YouTubeVideoDTO[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showChat, setShowChat] = useState(true);
  const [showOutline, setShowOutline] = useState(false);
  const [expandedExample, setExpandedExample] = useState<number | null>(0);
  const [isCompleted, setIsCompleted] = useState(false);
  const [showCompletionBadge, setShowCompletionBadge] = useState(false);

  // Find lesson info
  const allLessons = roadmap.flatMap(w =>
    w.lessons.map(l => ({ ...l, weekTitle: w.title, weekId: w.id }))
  );
  const currentIndex = allLessons.findIndex(l => l.id === lessonId);
  const currentLesson = allLessons[currentIndex];
  const prevLesson = currentIndex > 0 ? allLessons[currentIndex - 1] : null;
  const nextLesson = currentIndex < allLessons.length - 1 ? allLessons[currentIndex + 1] : null;

  useEffect(() => {
    if (!currentLesson) return;
    setIsLoading(true);
    setContent(null);
    setVideos([]);
    setIsCompleted(currentLesson.completed);
    setExpandedExample(0);

    Promise.all([
      generateLessonContent(currentLesson.title, currentLesson.weekTitle),
      searchYouTube(currentLesson.title),
    ]).then(([lessonContent, ytVideos]) => {
      setContent(lessonContent);
      setVideos(ytVideos);
      setIsLoading(false);
    });
  }, [lessonId]);

  const handleComplete = () => {
    if (!currentLesson || isCompleted) return;
    completeLesson(currentLesson.id);
    setIsCompleted(true);
    setShowCompletionBadge(true);
    setTimeout(() => setShowCompletionBadge(false), 3000);
  };

  if (!currentLesson) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <BookOpen size={48} className="text-zinc-700" />
        <p className="text-zinc-400">Chọn một bài học để bắt đầu</p>
        <button onClick={() => navigate('/roadmap')} className="px-4 py-2 rounded-xl bg-violet-600 text-white text-sm">
          Xem lộ trình
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
              {roadmap.map(week => (
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
              ))}
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
                <span className="text-violet-400">{currentLesson.weekTitle}</span>
                <span className="mx-1">›</span>
                <span>{currentLesson.title}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-full ${
                currentLesson.type === 'theory' ? 'bg-blue-500/20 text-blue-400' :
                currentLesson.type === 'practice' ? 'bg-emerald-500/20 text-emerald-400' :
                'bg-orange-500/20 text-orange-400'
              }`}>
                {currentLesson.type === 'theory' ? <BookOpen size={11} /> : currentLesson.type === 'practice' ? <Hammer size={11} /> : <Rocket size={11} />}
                {currentLesson.type === 'theory' ? 'Lý thuyết' : currentLesson.type === 'practice' ? 'Thực hành' : 'Dự án'}
              </div>
              <div className="flex items-center gap-1 text-xs text-zinc-500">
                <Clock size={12} />{currentLesson.duration}
              </div>
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
                {currentLesson.title}
              </h1>
              <p className="text-zinc-500 text-sm mt-1">{currentLesson.description}</p>
            </motion.div>

            {isLoading ? (
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
                  <span className="text-zinc-400 text-sm">AI đang biên soạn nội dung bài học...</span>
                </div>
              </div>
            ) : content && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8">
                {/* Theory */}
                <div>
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-6 h-6 rounded-lg bg-blue-500/20 border border-blue-500/30 flex items-center justify-center">
                      <BookOpen size={13} className="text-blue-400" />
                    </div>
                    <h2 className="text-lg text-white" style={{ fontWeight: 600 }}>Lý Thuyết</h2>
                  </div>
                  <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
                    <MarkdownContent content={content.theory} />
                  </div>
                </div>

                {/* Key points */}
                <div className="bg-violet-500/10 border border-violet-500/20 rounded-2xl p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <Lightbulb size={16} className="text-yellow-400" />
                    <h3 className="text-sm text-white" style={{ fontWeight: 600 }}>Điểm Cần Nhớ</h3>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {content.keyPoints.map((point, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm text-zinc-300">
                        <div className="w-1.5 h-1.5 rounded-full bg-violet-400 flex-shrink-0" />
                        {point}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Examples */}
                <div>
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-6 h-6 rounded-lg bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center">
                      <Code2 size={13} className="text-emerald-400" />
                    </div>
                    <h2 className="text-lg text-white" style={{ fontWeight: 600 }}>Ví Dụ Thực Tế</h2>
                  </div>
                  <div className="space-y-4">
                    {content.examples.map((example, i) => (
                      <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
                        <button
                          onClick={() => setExpandedExample(expandedExample === i ? null : i)}
                          className="w-full flex items-center justify-between px-5 py-4 hover:bg-zinc-800/30 transition-colors"
                        >
                          <div className="flex items-center gap-3">
                            <span className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 text-xs flex items-center justify-center flex-shrink-0" style={{ fontWeight: 700 }}>{i + 1}</span>
                            <div className="text-left">
                              <p className="text-sm text-white" style={{ fontWeight: 600 }}>{example.title}</p>
                              <p className="text-xs text-zinc-500">{example.description}</p>
                            </div>
                          </div>
                          {expandedExample === i ? <ChevronUp size={16} className="text-zinc-500" /> : <ChevronDown size={16} className="text-zinc-500" />}
                        </button>
                        <AnimatePresence>
                          {expandedExample === i && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              className="overflow-hidden"
                            >
                              <div className="px-5 pb-5">
                                {example.code && <CodeBlock code={example.code} />}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    ))}
                  </div>
                </div>

                {/* YouTube Videos */}
                {videos.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-4">
                      <div className="w-6 h-6 rounded-lg bg-red-500/20 border border-red-500/30 flex items-center justify-center">
                        <Youtube size={13} className="text-red-400" />
                      </div>
                      <h2 className="text-lg text-white" style={{ fontWeight: 600 }}>Video Tham Khảo</h2>
                      <span className="text-xs text-zinc-600">· Được AI chọn lọc</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {videos.map(video => (
                        <a
                          key={video.id}
                          href={video.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="group flex gap-3 bg-zinc-900 border border-zinc-800 rounded-xl p-3 hover:border-red-500/30 transition-all"
                        >
                          <div className="relative flex-shrink-0 w-28 h-16 rounded-lg overflow-hidden bg-zinc-800">
                            <img src={video.thumbnail} alt={video.title} className="w-full h-full object-cover" />
                            <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Play size={20} className="text-white" fill="white" />
                            </div>
                            <div className="absolute bottom-1 right-1 text-xs bg-black/80 text-white px-1.5 py-0.5 rounded">
                              {video.duration}
                            </div>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-zinc-200 leading-snug line-clamp-2 group-hover:text-white transition-colors">{video.title}</p>
                            <p className="text-xs text-zinc-600 mt-1">{video.channel}</p>
                            <p className="text-xs text-zinc-700 mt-0.5">{video.views}</p>
                          </div>
                          <ExternalLink size={14} className="text-zinc-600 flex-shrink-0 mt-0.5 group-hover:text-zinc-400" />
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </motion.div>
            )}
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
                disabled={isCompleted}
                className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm transition-all ${
                  isCompleted
                    ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 cursor-default'
                    : 'bg-violet-600 hover:bg-violet-500 text-white'
                }`}
                style={{ fontWeight: 600 }}
              >
                {isCompleted ? (
                  <><CheckCircle2 size={16} />Đã hoàn thành · +50 EXP</>
                ) : (
                  <><Zap size={16} />Hoàn thành bài học</>
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
              <p className="text-emerald-400 text-xs">+50 EXP đã được thêm vào tài khoản</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}