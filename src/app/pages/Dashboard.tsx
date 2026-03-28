import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router';
import {
  BookOpen, Flame, Trophy, Zap, Target, ChevronRight,
  TrendingUp, Clock, Star, Play, CheckCircle2, Brain,
  Send, Sparkles, BookOpen as TheoryIcon, Hammer, Rocket,
  Plus, X
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import ProgressHeatmap from '../components/ProgressHeatmap';
import { Lesson } from '../lib/types';

const EXP_REWARDS = [
  { icon: BookOpen, label: 'Hoàn thành bài học', exp: '+50 EXP', color: 'text-violet-400', bg: 'bg-violet-500/10' },
  { icon: Brain, label: 'Làm đúng Quiz', exp: '+30 EXP', color: 'text-cyan-400', bg: 'bg-cyan-500/10' },
  { icon: Flame, label: 'Duy trì Streak', exp: '+20 EXP', color: 'text-orange-400', bg: 'bg-orange-500/10' },
  { icon: Trophy, label: 'Hoàn thành tuần', exp: '+200 EXP', color: 'text-yellow-400', bg: 'bg-yellow-500/10' },
];

const TYPE_OPTIONS: { type: Lesson['type']; label: string; icon: React.ElementType; color: string; bg: string }[] = [
  { type: 'theory', label: 'Lý thuyết', icon: TheoryIcon, color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/20' },
  { type: 'practice', label: 'Thực hành', icon: Hammer, color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20' },
  { type: 'project', label: 'Dự án', icon: Rocket, color: 'text-orange-400', bg: 'bg-orange-500/10 border-orange-500/20' },
];

const QUICK_SUGGESTIONS = [
  'Ôn tập Python cơ bản',
  'Thực hành DataFrame với Pandas',
  'Học Matplotlib vẽ biểu đồ',
  'Machine Learning với scikit-learn',
  'SQL cho Data Analysis',
];

function QuickAddLesson() {
  const { addCustomLesson } = useApp();
  const [value, setValue] = useState('');
  const [selectedType, setSelectedType] = useState<Lesson['type']>('theory');
  const [showTypePicker, setShowTypePicker] = useState(false);
  const [added, setAdded] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleAdd = (title?: string) => {
    const t = (title ?? value).trim();
    if (!t) return;
    addCustomLesson(t, selectedType);
    setAdded(t);
    setValue('');
    setTimeout(() => setAdded(null), 2800);
    inputRef.current?.focus();
  };

  const currentType = TYPE_OPTIONS.find(o => o.type === selectedType)!;
  const TypeIcon = currentType.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.08 }}
      className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4"
    >
      {/* Label */}
      <div className="flex items-center gap-2 mb-3">
        <Plus size={14} className="text-violet-400" />
        <p className="text-xs text-zinc-500" style={{ fontWeight: 500 }}>Thêm bài học mới vào danh sách của bạn</p>
      </div>

      {/* Input row */}
      <div className="flex gap-2">
        {/* Type selector */}
        <div className="relative">
          <button
            onClick={() => setShowTypePicker(p => !p)}
            className={`h-10 flex items-center gap-1.5 px-3 rounded-xl border text-xs transition-colors ${currentType.bg} ${currentType.color}`}
            style={{ fontWeight: 600 }}
          >
            <TypeIcon size={13} />
            <span className="hidden sm:inline">{currentType.label}</span>
          </button>
          <AnimatePresence>
            {showTypePicker && (
              <motion.div
                initial={{ opacity: 0, y: 4, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 4, scale: 0.97 }}
                transition={{ duration: 0.15 }}
                className="absolute top-12 left-0 z-30 bg-zinc-900 border border-zinc-700 rounded-xl overflow-hidden shadow-xl min-w-36"
              >
                {TYPE_OPTIONS.map(opt => {
                  const Icon = opt.icon;
                  return (
                    <button
                      key={opt.type}
                      onClick={() => { setSelectedType(opt.type); setShowTypePicker(false); }}
                      className={`w-full flex items-center gap-2 px-3 py-2.5 text-xs hover:bg-zinc-800 transition-colors ${opt.color} ${selectedType === opt.type ? 'bg-zinc-800' : ''}`}
                    >
                      <Icon size={13} />
                      <span style={{ fontWeight: selectedType === opt.type ? 600 : 400 }}>{opt.label}</span>
                      {selectedType === opt.type && <CheckCircle2 size={12} className="ml-auto opacity-70" />}
                    </button>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Text input */}
        <div className="flex-1 flex items-center bg-zinc-800 border border-zinc-700 rounded-xl focus-within:border-violet-500/50 transition-colors overflow-hidden">
          <input
            ref={inputRef}
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
            placeholder="Bạn muốn học gì? Nhấn Enter để thêm..."
            className="flex-1 bg-transparent text-sm text-zinc-200 placeholder:text-zinc-600 px-4 py-2.5 outline-none"
          />
          <button
            onClick={() => handleAdd()}
            disabled={!value.trim()}
            className="w-10 h-10 flex items-center justify-center text-violet-400 hover:text-white hover:bg-violet-600 disabled:opacity-30 disabled:cursor-not-allowed transition-all rounded-r-xl flex-shrink-0"
          >
            <Send size={15} />
          </button>
        </div>
      </div>

      {/* Success toast */}
      <AnimatePresence>
        {added && (
          <motion.div
            initial={{ opacity: 0, height: 0, marginTop: 0 }}
            animate={{ opacity: 1, height: 'auto', marginTop: 10 }}
            exit={{ opacity: 0, height: 0, marginTop: 0 }}
            className="overflow-hidden"
          >
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
              <CheckCircle2 size={14} className="text-emerald-400 flex-shrink-0" />
              <p className="text-xs text-emerald-400" style={{ fontWeight: 500 }}>
                Đã thêm: <span className="text-emerald-300">"{added}"</span>
              </p>
              <button onClick={() => setAdded(null)} className="ml-auto">
                <X size={12} className="text-emerald-600 hover:text-emerald-400" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Quick suggestions */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        <span className="text-xs text-zinc-600 self-center">Gợi ý:</span>
        {QUICK_SUGGESTIONS.map(s => (
          <button
            key={s}
            onClick={() => handleAdd(s)}
            className="text-xs px-2.5 py-1 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-500 hover:text-violet-300 hover:border-violet-500/40 transition-all"
          >
            {s}
          </button>
        ))}
      </div>
    </motion.div>
  );
}

export default function Dashboard() {
  const { user, roadmap, activityData } = useApp();
  const navigate = useNavigate();

  const allLessons = roadmap.flatMap(w => w.lessons);
  const completedLessons = allLessons.filter(l => l.completed).length;
  const totalLessons = allLessons.length;
  const overallProgress = totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0;

  const nextLesson = roadmap.flatMap(w =>
    w.lessons.map(l => ({ ...l, weekTitle: w.title, weekId: w.id }))
  ).find(l => !l.completed);

  const expProgress = Math.round((user.exp / user.expToNextLevel) * 100);

  const weeklyStats = roadmap.map(week => ({
    ...week,
    completedCount: week.lessons.filter(l => l.completed).length,
    totalCount: week.lessons.length,
    pct: week.lessons.length > 0 ? Math.round((week.lessons.filter(l => l.completed).length / week.lessons.length) * 100) : 0,
  }));

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
      {/* Welcome header */}
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl text-white" style={{ fontWeight: 700 }}>
              Chào buổi sáng, {user.name}! 👋
            </h1>
            <p className="text-zinc-400 mt-1">Hôm nay bạn muốn học gì?</p>
          </div>
          {nextLesson && (
            <button
              onClick={() => navigate(`/learn/${nextLesson.id}`)}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white transition-colors text-sm"
              style={{ fontWeight: 600 }}
            >
              <Play size={15} />
              Tiếp tục học
            </button>
          )}
        </div>

        {/* Quick Add Lesson box — right below the greeting */}
        <div className="mt-4">
          <QuickAddLesson />
        </div>
      </motion.div>

      {/* Stats row */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { icon: Flame, label: 'Streak', value: `${user.streak} ngày`, sub: 'Chuỗi học liên tục', bg: 'bg-orange-500/10', border: 'border-orange-500/20', iconColor: 'text-orange-400' },
          { icon: Zap, label: 'EXP', value: `${user.exp.toLocaleString()}`, sub: `Cấp ${user.level} · ${expProgress}% → Cấp ${user.level + 1}`, bg: 'bg-violet-500/10', border: 'border-violet-500/20', iconColor: 'text-violet-400' },
          { icon: CheckCircle2, label: 'Bài học', value: `${completedLessons}/${totalLessons}`, sub: `${overallProgress}% hoàn thành`, bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', iconColor: 'text-emerald-400' },
          { icon: Clock, label: 'Thời gian', value: `${user.totalDays} ngày`, sub: 'Tổng ngày học tập', bg: 'bg-cyan-500/10', border: 'border-cyan-500/20', iconColor: 'text-cyan-400' },
        ].map(({ icon: Icon, label, value, sub, bg, border, iconColor }) => (
          <div key={label} className={`${bg} border ${border} rounded-2xl p-5`}>
            <div className="flex items-start justify-between mb-3">
              <Icon size={20} className={iconColor} />
              <span className="text-xs text-zinc-600 uppercase tracking-wider" style={{ fontWeight: 600 }}>{label}</span>
            </div>
            <p className="text-2xl text-white" style={{ fontWeight: 700 }}>{value}</p>
            <p className="text-xs text-zinc-500 mt-1">{sub}</p>
          </div>
        ))}
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Main content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Continue learning card */}
          {nextLesson && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="bg-violet-500/10 border border-violet-500/30 rounded-2xl p-6">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-2 h-2 rounded-full bg-violet-400 animate-pulse" />
                    <span className="text-xs text-violet-400 uppercase tracking-wider" style={{ fontWeight: 600 }}>Bài tiếp theo</span>
                  </div>
                  <h3 className="text-lg text-white" style={{ fontWeight: 700 }}>{nextLesson.title}</h3>
                  <p className="text-sm text-zinc-400 mt-1">{nextLesson.weekTitle} · {nextLesson.duration}</p>
                  <div className="mt-3 flex items-center gap-3">
                    <div className={`text-xs px-2 py-1 rounded-full ${
                      nextLesson.type === 'theory' ? 'bg-blue-500/20 text-blue-400' :
                      nextLesson.type === 'practice' ? 'bg-emerald-500/20 text-emerald-400' :
                      'bg-orange-500/20 text-orange-400'
                    }`}>
                      {nextLesson.type === 'theory' ? '📖 Lý thuyết' : nextLesson.type === 'practice' ? '💻 Thực hành' : '🚀 Dự án'}
                    </div>
                    <span className="text-xs text-zinc-500">{nextLesson.duration}</span>
                  </div>
                </div>
                <button
                  onClick={() => navigate(`/learn/${nextLesson.id}`)}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white transition-colors text-sm flex-shrink-0"
                  style={{ fontWeight: 600 }}
                >
                  <Play size={14} />Bắt đầu
                </button>
              </div>

              {/* Progress bar */}
              <div className="mt-4">
                <div className="flex justify-between text-xs text-zinc-500 mb-1.5">
                  <span>Tiến độ lộ trình</span>
                  <span>{overallProgress}%</span>
                </div>
                <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${overallProgress}%` }}
                    transition={{ duration: 1, delay: 0.5 }}
                    className="h-full bg-violet-500 rounded-full"
                  />
                </div>
              </div>
            </motion.div>
          )}

          {/* Weekly roadmap progress */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <Target size={18} className="text-violet-400" />
                <h2 className="text-white" style={{ fontWeight: 600 }}>Lộ Trình Học Tập</h2>
              </div>
              <button onClick={() => navigate('/roadmap')} className="flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300 transition-colors">
                Xem chi tiết<ChevronRight size={14} />
              </button>
            </div>
            <div className="space-y-3">
              {weeklyStats.map((week, i) => (
                <motion.div
                  key={week.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.2 + i * 0.08 }}
                  className="flex items-center gap-4"
                >
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs flex-shrink-0 ${
                    week.completed ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
                    week.pct > 0 ? 'bg-violet-500/20 text-violet-400 border border-violet-500/30' :
                    'bg-zinc-800 text-zinc-500 border border-zinc-700'
                  }`} style={{ fontWeight: 700 }}>
                    {week.completed ? <CheckCircle2 size={14} /> : week.weekNumber}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-sm text-zinc-300 truncate" style={{ fontWeight: week.pct > 0 ? 500 : 400 }}>{week.title}</p>
                      <span className="text-xs text-zinc-500 ml-2 flex-shrink-0">{week.completedCount}/{week.totalCount}</span>
                    </div>
                    <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${week.pct}%` }}
                        transition={{ duration: 0.8, delay: 0.5 + i * 0.1 }}
                        className={`h-full rounded-full ${week.completed ? 'bg-emerald-500' : 'bg-violet-500'}`}
                      />
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>

            {/* Link to all lessons */}
            <button
              onClick={() => navigate('/lessons')}
              className="mt-5 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-zinc-800/60 border border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-600 transition-all text-sm"
            >
              <Sparkles size={14} className="text-violet-400" />
              Xem toàn bộ bài học của tôi
              <ChevronRight size={14} />
            </button>
          </div>

          {/* Activity Heatmap */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-5">
              <TrendingUp size={18} className="text-cyan-400" />
              <h2 className="text-white" style={{ fontWeight: 600 }}>Hoạt Động Học Tập</h2>
            </div>
            <ProgressHeatmap data={activityData} />
          </div>
        </div>

        {/* Right sidebar */}
        <div className="space-y-5">
          {/* Level card */}
          <div className="bg-zinc-900 border border-violet-500/20 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Star size={16} className="text-yellow-400" />
                <span className="text-sm text-white" style={{ fontWeight: 600 }}>Cấp Độ</span>
              </div>
              <span className="text-xs text-zinc-500">Lv.{user.level}</span>
            </div>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-14 h-14 rounded-full bg-violet-600 flex items-center justify-center">
                <span className="text-xl" style={{ fontWeight: 800 }}>{user.level}</span>
              </div>
              <div>
                <p className="text-white text-sm" style={{ fontWeight: 600 }}>
                  {user.level < 5 ? 'Người Mới' : user.level < 10 ? 'Học Giả' : user.level < 20 ? 'Chuyên Gia' : 'Bậc Thầy'}
                </p>
                <p className="text-xs text-zinc-500">{user.exp}/{user.expToNextLevel} EXP → Cấp {user.level + 1}</p>
              </div>
            </div>
            <div className="space-y-1">
              <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${expProgress}%` }}
                  transition={{ duration: 1, delay: 0.3 }}
                  className="h-full bg-violet-500 rounded-full"
                />
              </div>
              <p className="text-xs text-zinc-600 text-right">{user.expToNextLevel - user.exp} EXP nữa để lên cấp</p>
            </div>
          </div>

          {/* EXP Rewards */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <Zap size={16} className="text-yellow-400" />
              <h3 className="text-sm text-white" style={{ fontWeight: 600 }}>Bảng EXP</h3>
            </div>
            <div className="space-y-2.5">
              {EXP_REWARDS.map(({ icon: Icon, label, exp, color, bg }) => (
                <div key={label} className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-lg ${bg} flex items-center justify-center flex-shrink-0`}>
                    <Icon size={14} className={color} />
                  </div>
                  <div className="flex-1">
                    <p className="text-xs text-zinc-300">{label}</p>
                  </div>
                  <span className="text-xs text-zinc-400" style={{ fontWeight: 600 }}>{exp}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Quick actions */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
            <h3 className="text-sm text-white mb-4" style={{ fontWeight: 600 }}>Hành động nhanh</h3>
            <div className="space-y-2">
              {[
                { label: '🗺️ Tạo lộ trình mới', to: '/roadmap', color: 'hover:border-violet-500/50 hover:text-violet-300' },
                { label: '📖 Tiếp tục học', to: nextLesson ? `/learn/${nextLesson.id}` : '/learn', color: 'hover:border-cyan-500/50 hover:text-cyan-300' },
                { label: '🧠 Làm quiz & flashcard', to: '/quiz', color: 'hover:border-emerald-500/50 hover:text-emerald-300' },
                { label: '📚 Xem tất cả bài học', to: '/lessons', color: 'hover:border-violet-500/50 hover:text-violet-300' },
              ].map(({ label, to, color }) => (
                <button
                  key={label}
                  onClick={() => navigate(to)}
                  className={`w-full text-left text-sm px-4 py-2.5 rounded-xl bg-zinc-800/50 border border-zinc-700 text-zinc-400 transition-all ${color}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}