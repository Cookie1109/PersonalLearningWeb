import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router';
import {
  BookMarked, CheckCircle2, Clock, Play, Search,
  BookOpen, Hammer, Rocket, Filter, ChevronDown,
  Circle, Layers, ListChecks, TrendingUp
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Lesson } from '../lib/types';

type FilterTab = 'all' | 'inprogress' | 'completed';

function TypeBadge({ type }: { type: Lesson['type'] }) {
  if (type === 'theory')
    return (
      <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
        <BookOpen size={10} />Lý thuyết
      </span>
    );
  if (type === 'practice')
    return (
      <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
        <Hammer size={10} />Thực hành
      </span>
    );
  return (
    <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-400 border border-orange-500/20">
      <Rocket size={10} />Dự án
    </span>
  );
}

interface LessonWithMeta extends Lesson {
  weekTitle: string;
  weekId: string;
  weekNumber: number;
}

export default function LessonsPage() {
  const { roadmap } = useApp();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<FilterTab>('all');
  const [search, setSearch] = useState('');
  const [expandedWeeks, setExpandedWeeks] = useState<Set<string>>(new Set(['all']));

  const allLessonsFlat: LessonWithMeta[] = useMemo(() =>
    roadmap.flatMap(week =>
      week.lessons.map(lesson => ({
        ...lesson,
        weekTitle: week.title,
        weekId: week.id,
        weekNumber: week.weekNumber,
      }))
    ), [roadmap]);

  const filtered = useMemo(() => {
    return allLessonsFlat.filter(l => {
      const matchSearch = search === '' || l.title.toLowerCase().includes(search.toLowerCase()) || l.description.toLowerCase().includes(search.toLowerCase());
      const matchFilter =
        filter === 'all' ? true :
        filter === 'completed' ? l.completed :
        !l.completed;
      return matchSearch && matchFilter;
    });
  }, [allLessonsFlat, filter, search]);

  // Group filtered lessons by week
  const groupedByWeek = useMemo(() => {
    const map = new Map<string, { weekTitle: string; weekNumber: number; weekId: string; lessons: LessonWithMeta[] }>();
    filtered.forEach(l => {
      if (!map.has(l.weekId)) {
        map.set(l.weekId, { weekTitle: l.weekTitle, weekNumber: l.weekNumber, weekId: l.weekId, lessons: [] });
      }
      map.get(l.weekId)!.lessons.push(l);
    });
    return Array.from(map.values()).sort((a, b) => a.weekNumber - b.weekNumber);
  }, [filtered]);

  const stats = useMemo(() => {
    const total = allLessonsFlat.length;
    const completed = allLessonsFlat.filter(l => l.completed).length;
    const inProgress = total - completed;
    const thisWeek = roadmap.find(w => !w.completed);
    return { total, completed, inProgress, currentWeek: thisWeek?.title ?? '—' };
  }, [allLessonsFlat, roadmap]);

  const toggleWeek = (weekId: string) => {
    setExpandedWeeks(prev => {
      const next = new Set(prev);
      if (next.has(weekId)) next.delete(weekId);
      else next.add(weekId);
      return next;
    });
  };

  const tabs: { key: FilterTab; label: string; count: number }[] = [
    { key: 'all', label: 'Tất cả', count: allLessonsFlat.length },
    { key: 'inprogress', label: 'Đang học', count: allLessonsFlat.filter(l => !l.completed).length },
    { key: 'completed', label: 'Đã hoàn thành', count: allLessonsFlat.filter(l => l.completed).length },
  ];

  return (
    <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-xl bg-violet-600 flex items-center justify-center">
            <BookMarked size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl text-white" style={{ fontWeight: 700 }}>Bài Học Của Tôi</h1>
            <p className="text-zinc-500 text-sm">Toàn bộ nội dung học tập theo lộ trình</p>
          </div>
        </div>
      </motion.div>

      {/* Stats */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="grid grid-cols-2 sm:grid-cols-4 gap-4"
      >
        {[
          { icon: Layers, label: 'Tổng bài học', value: stats.total, color: 'text-zinc-300', bg: 'bg-zinc-800/60', border: 'border-zinc-700' },
          { icon: TrendingUp, label: 'Đang học', value: stats.inProgress, color: 'text-violet-400', bg: 'bg-violet-500/10', border: 'border-violet-500/20' },
          { icon: CheckCircle2, label: 'Đã hoàn thành', value: stats.completed, color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
          { icon: ListChecks, label: 'Tuần hiện tại', value: stats.currentWeek, color: 'text-cyan-400', bg: 'bg-cyan-500/10', border: 'border-cyan-500/20' },
        ].map(({ icon: Icon, label, value, color, bg, border }) => (
          <div key={label} className={`${bg} border ${border} rounded-2xl p-4`}>
            <Icon size={16} className={`${color} mb-2`} />
            <p className={`text-xl ${color}`} style={{ fontWeight: 700 }}>{value}</p>
            <p className="text-xs text-zinc-500 mt-0.5">{label}</p>
          </div>
        ))}
      </motion.div>

      {/* Controls */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.1 }}
        className="flex flex-col sm:flex-row gap-3"
      >
        {/* Search */}
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Tìm kiếm bài học..."
            className="w-full bg-zinc-900 border border-zinc-800 rounded-xl pl-9 pr-4 py-2.5 text-sm text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-violet-500/50 transition-colors"
          />
        </div>

        {/* Filter tabs */}
        <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded-xl p-1">
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-all ${
                filter === tab.key
                  ? 'bg-violet-600 text-white'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
              style={{ fontWeight: filter === tab.key ? 600 : 400 }}
            >
              {tab.label}
              <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                filter === tab.key ? 'bg-white/20' : 'bg-zinc-800'
              }`}>{tab.count}</span>
            </button>
          ))}
        </div>
      </motion.div>

      {/* Lessons grouped by week */}
      <div className="space-y-4">
        <AnimatePresence mode="popLayout">
          {groupedByWeek.length === 0 ? (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center py-16"
            >
              <div className="w-16 h-16 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mx-auto mb-3">
                <BookOpen size={28} className="text-zinc-700" />
              </div>
              <p className="text-zinc-400" style={{ fontWeight: 500 }}>Không tìm thấy bài học nào</p>
              <p className="text-zinc-600 text-sm mt-1">Thử thay đổi bộ lọc hoặc từ khóa tìm kiếm</p>
            </motion.div>
          ) : groupedByWeek.map((group, gi) => {
            const isExpanded = expandedWeeks.has(group.weekId) || expandedWeeks.has('all');
            const weekCompleted = group.lessons.every(l => l.completed);
            const weekProgress = Math.round((group.lessons.filter(l => l.completed).length / group.lessons.length) * 100);

            return (
              <motion.div
                key={group.weekId}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ delay: gi * 0.05 }}
                className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden"
              >
                {/* Week header */}
                <button
                  onClick={() => toggleWeek(group.weekId)}
                  className="w-full flex items-center gap-4 px-5 py-4 hover:bg-zinc-800/40 transition-colors text-left"
                >
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-sm flex-shrink-0 border ${
                    weekCompleted
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                      : 'bg-violet-500/10 border-violet-500/30 text-violet-400'
                  }`} style={{ fontWeight: 700 }}>
                    {weekCompleted ? <CheckCircle2 size={16} /> : group.weekNumber}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm text-white truncate" style={{ fontWeight: 600 }}>
                        {group.weekId === 'week-custom' ? '📌 ' : `Tuần ${group.weekNumber}: `}{group.weekTitle}
                      </p>
                      {weekCompleted && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex-shrink-0">
                          Hoàn thành
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1.5">
                      <div className="flex-1 h-1 bg-zinc-800 rounded-full overflow-hidden max-w-32">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${weekCompleted ? 'bg-emerald-500' : 'bg-violet-500'}`}
                          style={{ width: `${weekProgress}%` }}
                        />
                      </div>
                      <span className="text-xs text-zinc-500">
                        {group.lessons.filter(l => l.completed).length}/{group.lessons.length} bài
                      </span>
                    </div>
                  </div>
                  <motion.div animate={{ rotate: isExpanded ? 180 : 0 }} transition={{ duration: 0.2 }}>
                    <ChevronDown size={16} className="text-zinc-500 flex-shrink-0" />
                  </motion.div>
                </button>

                {/* Lessons list */}
                <AnimatePresence initial={false}>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.25 }}
                      className="overflow-hidden border-t border-zinc-800"
                    >
                      <div className="p-3 space-y-1.5">
                        {group.lessons.map((lesson, li) => (
                          <motion.div
                            key={lesson.id}
                            initial={{ opacity: 0, x: -8 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: li * 0.04 }}
                            className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all group ${
                              lesson.completed
                                ? 'bg-emerald-500/5 border-emerald-500/15 hover:border-emerald-500/30'
                                : 'bg-zinc-800/40 border-zinc-700/50 hover:border-violet-500/30 hover:bg-zinc-800/70'
                            }`}
                          >
                            {/* Status icon */}
                            <div className="flex-shrink-0">
                              {lesson.completed ? (
                                <CheckCircle2 size={18} className="text-emerald-400" />
                              ) : (
                                <Circle size={18} className="text-zinc-600 group-hover:text-violet-400 transition-colors" />
                              )}
                            </div>

                            {/* Info */}
                            <div className="flex-1 min-w-0">
                              <p className={`text-sm truncate ${lesson.completed ? 'text-zinc-400 line-through decoration-zinc-600' : 'text-zinc-200'}`} style={{ fontWeight: lesson.completed ? 400 : 500 }}>
                                {lesson.title}
                              </p>
                              <p className="text-xs text-zinc-600 mt-0.5 truncate">{lesson.description}</p>
                            </div>

                            {/* Meta */}
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <TypeBadge type={lesson.type} />
                              <div className="flex items-center gap-1 text-xs text-zinc-600">
                                <Clock size={11} />
                                <span>{lesson.duration}</span>
                              </div>
                            </div>

                            {/* Action */}
                            {!lesson.completed && (
                              <button
                                onClick={() => navigate(`/learn/${lesson.id}`)}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0"
                                style={{ fontWeight: 600 }}
                              >
                                <Play size={11} />Học
                              </button>
                            )}
                            {lesson.completed && (
                              <button
                                onClick={() => navigate(`/learn/${lesson.id}`)}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-xs transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0"
                              >
                                Ôn lại
                              </button>
                            )}
                          </motion.div>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}
