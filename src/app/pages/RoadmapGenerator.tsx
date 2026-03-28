import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router';
import {
  Sparkles, Loader2, ChevronDown, ChevronRight, Trash2,
  Plus, GripVertical, CheckCircle2, Circle, Target, Wand2,
  Clock, BookOpen, Hammer, Rocket, Play, Edit3, Check, X
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { generateRoadmap } from '../../api/learning';
import { WeekModule, Lesson } from '../lib/types';

interface RoadmapGeneratorProps {
  suggestedGoalOptions?: string[];
  onGenerateRoadmap?: (goal: string) => Promise<WeekModule[]>;
}

function LessonTypeIcon({ type }: { type: Lesson['type'] }) {
  if (type === 'theory') return <BookOpen size={12} className="text-blue-400" />;
  if (type === 'practice') return <Hammer size={12} className="text-emerald-400" />;
  return <Rocket size={12} className="text-orange-400" />;
}

function LessonItem({ lesson, weekId, onDelete }: { lesson: Lesson; weekId: string; onDelete: () => void }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -10 }}
      className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-zinc-800/50 group transition-colors"
    >
      <GripVertical size={14} className="text-zinc-700 group-hover:text-zinc-500 cursor-grab" />
      <div className="flex items-center justify-center w-5 h-5 rounded-full border border-zinc-700 flex-shrink-0">
        <LessonTypeIcon type={lesson.type} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-zinc-300 truncate">{lesson.title}</p>
        <p className="text-xs text-zinc-600">{lesson.description}</p>
      </div>
      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <span className="text-xs text-zinc-600 flex items-center gap-1">
          <Clock size={10} />{lesson.duration}
        </span>
        <button onClick={onDelete} className="p-1 rounded text-zinc-600 hover:text-red-400 transition-colors">
          <Trash2 size={12} />
        </button>
      </div>
    </motion.div>
  );
}

export default function RoadmapGenerator({ suggestedGoalOptions = [], onGenerateRoadmap = generateRoadmap }: RoadmapGeneratorProps) {
  const { roadmap, currentGoal, setRoadmap, setCurrentGoal, toggleWeekExpand, deleteWeek, deleteLesson, resetRoadmap } = useApp();
  const navigate = useNavigate();

  const [inputGoal, setInputGoal] = useState(currentGoal);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatingStep, setGeneratingStep] = useState(0);
  const [hasGenerated, setHasGenerated] = useState(roadmap.length > 0);

  const STEPS = [
    'Phân tích mục tiêu của bạn...',
    'Thiết kế cấu trúc lộ trình...',
    'Sinh nội dung từng tuần...',
    'Tối ưu hóa thứ tự học tập...',
    'Hoàn thành lộ trình! 🎉',
  ];

  const handleGenerate = async () => {
    if (!inputGoal.trim() || isGenerating) return;
    setIsGenerating(true);
    setGeneratingStep(0);

    const stepInterval = setInterval(() => {
      setGeneratingStep(prev => {
        if (prev < STEPS.length - 1) return prev + 1;
        clearInterval(stepInterval);
        return prev;
      });
    }, 500);

    try {
      const newRoadmap = await onGenerateRoadmap(inputGoal);
      setRoadmap(newRoadmap);
      setCurrentGoal(inputGoal);
      setHasGenerated(true);
    } finally {
      clearInterval(stepInterval);
      setIsGenerating(false);
    }
  };

  const handleStartLearning = () => {
    const firstLesson = roadmap.flatMap(w => w.lessons)[0];
    if (firstLesson) navigate(`/learn/${firstLesson.id}`);
    else navigate('/learn');
  };

  const totalLessons = roadmap.flatMap(w => w.lessons).length;
  const totalWeeks = roadmap.length;
  const totalMinutes = roadmap.flatMap(w => w.lessons).reduce((sum, l) => {
    const mins = parseInt(l.duration) || 0;
    return sum + mins;
  }, 0);

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -15 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-violet-600 flex items-center justify-center">
            <Wand2 size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl text-white" style={{ fontWeight: 700 }}>AI Roadmap Generator</h1>
            <p className="text-zinc-500 text-sm">Khai báo mục tiêu — AI tạo lộ trình học tập cá nhân hóa</p>
          </div>
        </div>
      </motion.div>

      {/* Goal input */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 mb-6">
        <label className="block text-sm text-zinc-400 mb-3" style={{ fontWeight: 500 }}>
          <Target size={14} className="inline mr-2 text-violet-400" />
          Mục tiêu của bạn là gì?
        </label>
        <textarea
          value={inputGoal}
          onChange={e => setInputGoal(e.target.value)}
          placeholder='Ví dụ: "Tôi muốn học Python cơ bản để phân tích dữ liệu trong 4 tuần"'
          rows={3}
          className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-zinc-200 placeholder:text-zinc-600 resize-none outline-none focus:border-violet-500/60 transition-colors text-sm"
        />

        {/* Suggested goals */}
        <div className="mt-3">
          <p className="text-xs text-zinc-600 mb-2">Gợi ý:</p>
          <div className="flex flex-wrap gap-2">
            {suggestedGoalOptions.slice(0, 3).map(goal => (
              <button
                key={goal}
                onClick={() => setInputGoal(goal)}
                className="text-xs px-3 py-1.5 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-500 hover:text-violet-300 hover:border-violet-500/40 transition-all"
              >
                {goal.slice(0, 45)}...
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between mt-4">
          {hasGenerated && (
            <button
              onClick={() => { resetRoadmap(); setHasGenerated(false); }}
              className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              Xóa lộ trình hiện tại
            </button>
          )}
          <button
            onClick={handleGenerate}
            disabled={!inputGoal.trim() || isGenerating}
            className="ml-auto flex items-center gap-2 px-6 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors text-sm"
            style={{ fontWeight: 600 }}
          >
            {isGenerating ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            {isGenerating ? 'Đang tạo lộ trình...' : hasGenerated ? 'Tạo lại lộ trình' : 'Tạo Lộ Trình AI'}
          </button>
        </div>
      </motion.div>

      {/* Generating animation */}
      <AnimatePresence>
        {isGenerating && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-6 bg-violet-500/10 border border-violet-500/30 rounded-2xl p-6"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="relative w-8 h-8">
                <div className="w-8 h-8 rounded-full border-2 border-violet-500/30 border-t-violet-500 animate-spin" />
                <Sparkles size={14} className="text-violet-400 absolute inset-0 m-auto" />
              </div>
              <div>
                <p className="text-white text-sm" style={{ fontWeight: 600 }}>Gemini AI đang phân tích mục tiêu của bạn</p>
                <p className="text-violet-400 text-xs">{STEPS[generatingStep]}</p>
              </div>
            </div>
            <div className="space-y-2">
              {STEPS.map((step, i) => (
                <div key={step} className={`flex items-center gap-2 text-sm transition-all ${i <= generatingStep ? 'text-zinc-300' : 'text-zinc-700'}`}>
                  {i < generatingStep ? (
                    <CheckCircle2 size={14} className="text-emerald-400 flex-shrink-0" />
                  ) : i === generatingStep ? (
                    <Loader2 size={14} className="text-violet-400 animate-spin flex-shrink-0" />
                  ) : (
                    <Circle size={14} className="text-zinc-700 flex-shrink-0" />
                  )}
                  {step}
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Generated Roadmap */}
      <AnimatePresence>
        {hasGenerated && !isGenerating && roadmap.length > 0 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
            {/* Roadmap stats */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-white" style={{ fontWeight: 600 }}>Lộ Trình Của Bạn</h2>
                <p className="text-xs text-zinc-500 mt-1">
                  {totalWeeks} tuần · {totalLessons} bài học · ~{Math.round(totalMinutes / 60)} giờ học
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs text-zinc-500">
                <div className="flex items-center gap-1"><BookOpen size={12} className="text-blue-400" /><span>Lý thuyết</span></div>
                <div className="flex items-center gap-1"><Hammer size={12} className="text-emerald-400" /><span>Thực hành</span></div>
                <div className="flex items-center gap-1"><Rocket size={12} className="text-orange-400" /><span>Dự án</span></div>
              </div>
            </div>

            {/* Week cards */}
            {roadmap.map((week, wi) => (
              <motion.div
                key={week.id}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: wi * 0.08 }}
                className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden"
              >
                {/* Week header */}
                <div
                  className="flex items-center gap-4 px-5 py-4 cursor-pointer hover:bg-zinc-800/30 transition-colors"
                  onClick={() => toggleWeekExpand(week.id)}
                >
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm flex-shrink-0 ${
                    week.completed
                      ? 'bg-emerald-500/20 border border-emerald-500/30 text-emerald-400'
                      : 'bg-violet-500/20 border border-violet-500/30 text-violet-400'
                  }`} style={{ fontWeight: 700 }}>
                    {week.completed ? <CheckCircle2 size={18} /> : week.weekNumber}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-white text-sm" style={{ fontWeight: 600 }}>
                      Tuần {week.weekNumber}: {week.title}
                    </h3>
                    <p className="text-xs text-zinc-500 truncate">{week.description}</p>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-xs text-zinc-600">{week.lessons.length} bài</span>
                    <button
                      onClick={e => { e.stopPropagation(); deleteWeek(week.id); }}
                      className="p-1.5 rounded-lg text-zinc-600 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                    {week.expanded ? (
                      <ChevronDown size={16} className="text-zinc-500" />
                    ) : (
                      <ChevronRight size={16} className="text-zinc-500" />
                    )}
                  </div>
                </div>

                {/* Lessons list */}
                <AnimatePresence>
                  {week.expanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden border-t border-zinc-800"
                    >
                      <div className="px-3 py-2">
                        <AnimatePresence>
                          {week.lessons.map(lesson => (
                            <LessonItem
                              key={lesson.id}
                              lesson={lesson}
                              weekId={week.id}
                              onDelete={() => deleteLesson(week.id, lesson.id)}
                            />
                          ))}
                        </AnimatePresence>
                        <button className="flex items-center gap-2 text-xs text-zinc-600 hover:text-violet-400 mt-2 px-3 py-2 rounded-lg hover:bg-zinc-800/50 transition-all w-full">
                          <Plus size={12} />Thêm bài học (AI gợi ý)
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            ))}

            {/* Start learning CTA */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
              className="flex items-center justify-between bg-violet-500/10 border border-violet-500/30 rounded-2xl p-5 mt-6"
            >
              <div>
                <p className="text-white" style={{ fontWeight: 600 }}>Lộ trình đã sẵn sàng! 🚀</p>
                <p className="text-sm text-zinc-400 mt-0.5">Bạn có thể chỉnh sửa thêm hoặc bắt đầu học ngay</p>
              </div>
              <button
                onClick={handleStartLearning}
                className="flex items-center gap-2 px-6 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white transition-colors"
                style={{ fontWeight: 600 }}
              >
                <Play size={16} />Bắt Đầu Học
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Empty state */}
      {!hasGenerated && !isGenerating && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }} className="text-center py-16">
          <div className="w-20 h-20 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mx-auto mb-4">
            <Map size={36} className="text-zinc-700" />
          </div>
          <h3 className="text-zinc-400" style={{ fontWeight: 600 }}>Chưa có lộ trình nào</h3>
          <p className="text-zinc-600 text-sm mt-1">Nhập mục tiêu và để AI tạo lộ trình học tập cho bạn</p>
        </motion.div>
      )}
    </div>
  );
}

// Polyfill for Map icon
function Map({ size, className }: { size: number; className: string }) {
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21" />
      <line x1="9" y1="3" x2="9" y2="18" />
      <line x1="15" y1="6" x2="15" y2="21" />
    </svg>
  );
}