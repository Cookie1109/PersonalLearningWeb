import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router';
import {
  BookMarked,
  CheckCircle2,
  ChevronDown,
  Loader2,
  Lock,
  PlayCircle,
  RefreshCw,
} from 'lucide-react';
import { getMyRoadmaps, MyRoadmap } from '../../api/learning';

export default function LessonsPage() {
  const navigate = useNavigate();
  const [roadmaps, setRoadmaps] = useState<MyRoadmap[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedRoadmaps, setExpandedRoadmaps] = useState<Set<number>>(new Set());
  const [expandedWeeks, setExpandedWeeks] = useState<Set<string>>(new Set());

  const totalLessons = useMemo(
    () => roadmaps.flatMap(roadmap => roadmap.weeks.flatMap(week => week.lessons)).length,
    [roadmaps]
  );
  const completedLessons = useMemo(
    () => roadmaps.flatMap(roadmap => roadmap.weeks.flatMap(week => week.lessons)).filter(lesson => lesson.isCompleted).length,
    [roadmaps]
  );

  const fetchRoadmaps = async () => {
    setError(null);
    setIsLoading(true);

    try {
      const payload = await getMyRoadmaps();
      setRoadmaps(payload);

      if (payload.length > 0) {
        const firstRoadmapId = payload[0].roadmapId;
        setExpandedRoadmaps(new Set([firstRoadmapId]));

        const initialWeeks = payload[0].weeks.map(week => `${firstRoadmapId}-${week.weekNumber}`);
        setExpandedWeeks(new Set(initialWeeks.slice(0, 1)));
      }
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Khong the tai du lieu bai hoc. Vui long thu lai.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void fetchRoadmaps();
  }, []);

  const toggleRoadmap = (roadmapId: number) => {
    setExpandedRoadmaps(prev => {
      const next = new Set(prev);
      if (next.has(roadmapId)) next.delete(roadmapId);
      else next.add(roadmapId);
      return next;
    });
  };

  const toggleWeek = (roadmapId: number, weekNumber: number) => {
    const key = `${roadmapId}-${weekNumber}`;
    setExpandedWeeks(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-5">
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-violet-600 flex items-center justify-center">
            <BookMarked size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl text-white" style={{ fontWeight: 700 }}>Bai hoc cua toi</h1>
            <p className="text-zinc-500 text-sm">Hien thi theo cau truc Lo trinh -&gt; Tuan -&gt; Bai hoc</p>
          </div>
        </div>
      </motion.div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
          <p className="text-xs text-zinc-500">Tong bai hoc</p>
          <p className="text-xl text-zinc-100" style={{ fontWeight: 700 }}>{totalLessons}</p>
        </div>
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4">
          <p className="text-xs text-emerald-300">Da hoan thanh</p>
          <p className="text-xl text-emerald-300" style={{ fontWeight: 700 }}>{completedLessons}</p>
        </div>
      </div>

      {isLoading && (
        <div className="rounded-2xl border border-violet-500/30 bg-violet-500/10 px-4 py-5 flex items-center gap-3">
          <Loader2 size={18} className="text-violet-300 animate-spin" />
          <p className="text-sm text-violet-200">Dang tai danh sach lo trinh va bai hoc...</p>
        </div>
      )}

      {!isLoading && error && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-4">
          <p className="text-sm text-red-300">{error}</p>
          <button
            onClick={() => void fetchRoadmaps()}
            className="mt-3 inline-flex items-center gap-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 px-3 py-2 text-xs text-zinc-200"
          >
            <RefreshCw size={12} />Thu lai
          </button>
        </div>
      )}

      {!isLoading && !error && roadmaps.length === 0 && (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6 text-center">
          <p className="text-zinc-300" style={{ fontWeight: 600 }}>Chua co lo trinh nao</p>
          <p className="text-sm text-zinc-500 mt-1">Hay tao lo trinh moi tai trang Lo trinh AI.</p>
        </div>
      )}

      {!isLoading && !error && roadmaps.length > 0 && (
        <div className="space-y-4">
          {roadmaps.map(roadmap => {
            const roadmapExpanded = expandedRoadmaps.has(roadmap.roadmapId);
            const roadmapLessonCount = roadmap.weeks.flatMap(week => week.lessons).length;
            const roadmapCompletedCount = roadmap.weeks.flatMap(week => week.lessons).filter(lesson => lesson.isCompleted).length;

            return (
              <motion.section
                key={roadmap.roadmapId}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-2xl border border-zinc-800 bg-zinc-900 overflow-hidden"
              >
                <button
                  onClick={() => toggleRoadmap(roadmap.roadmapId)}
                  className="w-full text-left px-4 sm:px-5 py-4 hover:bg-zinc-800/50 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-lg text-white truncate" style={{ fontWeight: 700 }}>{roadmap.title}</p>
                      <p className="text-sm text-zinc-400 mt-1">Muc tieu: {roadmap.goal}</p>
                      <p className="text-xs text-zinc-500 mt-2">
                        {roadmapCompletedCount}/{roadmapLessonCount} bai da hoan thanh
                      </p>
                    </div>
                    <motion.div animate={{ rotate: roadmapExpanded ? 180 : 0 }} transition={{ duration: 0.2 }}>
                      <ChevronDown size={18} className="text-zinc-500 mt-1" />
                    </motion.div>
                  </div>
                </button>

                <AnimatePresence initial={false}>
                  {roadmapExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="border-t border-zinc-800"
                    >
                      <div className="p-3 sm:p-4 space-y-3">
                        {roadmap.weeks.map(week => {
                          const weekKey = `${roadmap.roadmapId}-${week.weekNumber}`;
                          const weekExpanded = expandedWeeks.has(weekKey);
                          const weekCompleted = week.lessons.every(lesson => lesson.isCompleted);

                          return (
                            <div key={weekKey} className="rounded-xl border border-zinc-700/70 bg-zinc-800/40 overflow-hidden">
                              <button
                                onClick={() => toggleWeek(roadmap.roadmapId, week.weekNumber)}
                                className="w-full px-3 sm:px-4 py-3 text-left hover:bg-zinc-700/30 transition-colors"
                              >
                                <div className="flex items-center gap-3">
                                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center border ${weekCompleted ? 'border-emerald-500/40 bg-emerald-500/20 text-emerald-300' : 'border-zinc-600 bg-zinc-700/60 text-zinc-300'}`}>
                                    {weekCompleted ? <CheckCircle2 size={14} /> : week.weekNumber}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm text-zinc-100" style={{ fontWeight: 600 }}>{week.title}</p>
                                    <p className="text-xs text-zinc-500">{week.lessons.length} bai hoc</p>
                                  </div>
                                  <motion.div animate={{ rotate: weekExpanded ? 180 : 0 }} transition={{ duration: 0.2 }}>
                                    <ChevronDown size={15} className="text-zinc-500" />
                                  </motion.div>
                                </div>
                              </button>

                              <AnimatePresence initial={false}>
                                {weekExpanded && (
                                  <motion.div
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    className="border-t border-zinc-700/70"
                                  >
                                    <div className="p-2 sm:p-3 space-y-2">
                                      {week.lessons.map(lesson => (
                                        <button
                                          key={lesson.id}
                                          onClick={() => navigate(`/learn/${lesson.id}`)}
                                          className={`w-full text-left rounded-lg border px-3 py-2.5 flex items-center gap-3 transition-colors ${lesson.isCompleted ? 'border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/15' : 'border-zinc-600 bg-zinc-800 hover:bg-zinc-700/60'}`}
                                        >
                                          {lesson.isCompleted ? (
                                            <CheckCircle2 size={16} className="text-emerald-400 flex-shrink-0" />
                                          ) : (
                                            <Lock size={16} className="text-zinc-500 flex-shrink-0" />
                                          )}

                                          <div className="flex-1 min-w-0">
                                            <p className={`text-sm truncate ${lesson.isCompleted ? 'text-emerald-100' : 'text-zinc-200'}`} style={{ fontWeight: 600 }}>
                                              {lesson.title}
                                            </p>
                                            <p className={`text-xs ${lesson.isCompleted ? 'text-emerald-300/80' : 'text-zinc-500'}`}>
                                              {lesson.isCompleted ? 'Da hoan thanh' : 'Chua hoan thanh'}
                                            </p>
                                          </div>

                                          <PlayCircle size={16} className="text-violet-400 flex-shrink-0" />
                                        </button>
                                      ))}
                                    </div>
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </div>
                          );
                        })}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.section>
            );
          })}
        </div>
      )}
    </div>
  );
}
