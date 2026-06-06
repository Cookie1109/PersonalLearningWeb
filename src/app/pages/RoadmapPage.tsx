import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  GripVertical,
  Loader2,
  Pencil,
  Plus,
  Sparkles,
  Target,
  Trash2,
  Wand2,
  X,
  Info,
  Trophy,
  Brain,
  ArrowRight,
  Compass,
} from 'lucide-react';
import {
  addLessonToRoadmap,
  deleteLessonFromRoadmap,
  deleteRoadmap,
  generateRoadmap,
  getMyRoadmaps,
  MyRoadmap,
  MyRoadmapLesson,
  renameLessonTitle,
  renameRoadmap,
  reorderLesson,
} from '../../api/learning';

// ─────────────────────────────────────────────────────────────────────────────
// Sortable Lesson Card
// ─────────────────────────────────────────────────────────────────────────────

interface SortableLessonCardProps {
  lesson: MyRoadmapLesson;
  idx: number;
  isCurrent: boolean;
  roadmapId: number;
  onDelete: (lessonId: number) => void;
  onRename: (lessonId: number, newTitle: string) => void;
  onNavigate: (lessonId: string) => void;
}

function SortableLessonCard({
  lesson,
  idx,
  isCurrent,
  roadmapId,
  onDelete,
  onRename,
  onNavigate,
}: SortableLessonCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: lesson.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(lesson.title);
  const [isSaving, setIsSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const startEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditValue(lesson.title);
    setIsEditing(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const saveEdit = async () => {
    const trimmed = editValue.trim();
    if (!trimmed || trimmed === lesson.title || trimmed.length < 3) {
      setIsEditing(false);
      setEditValue(lesson.title);
      return;
    }
    setIsSaving(true);
    try {
      await onRename(Number(lesson.id), trimmed);
    } finally {
      setIsSaving(false);
      setIsEditing(false);
    }
  };

  const cancelEdit = () => {
    setIsEditing(false);
    setEditValue(lesson.title);
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-4 group/row w-full"
    >
      {/* ── Timeline circle node (aligned on background track) ── */}
      <div className="relative flex-shrink-0 flex items-center justify-center w-8 h-8 z-10">
        {lesson.isCompleted ? (
          <div
            className="w-8 h-8 rounded-full bg-emerald-500/25 border-2 border-emerald-500 text-emerald-400 flex items-center justify-center shadow-[0_0_10px_rgba(16,185,129,0.3)] hover:scale-105 transition-transform"
            title="Đã học xong"
          >
            <CheckCircle2 size={16} className="text-emerald-400" strokeWidth={2.5} />
          </div>
        ) : isCurrent ? (
          <div
            className="w-8 h-8 rounded-full bg-cyan-600/30 border-2 border-cyan-500 text-cyan-400 flex items-center justify-center shadow-[0_0_12px_rgba(6,182,212,0.5)] relative cursor-pointer hover:scale-105 transition-transform"
            title="Bước học hiện tại"
            onClick={() => onNavigate(String(lesson.id))}
          >
            <span className="absolute inset-0 rounded-full bg-cyan-500/20 animate-ping duration-1000" />
            <BookOpen size={14} className="relative z-10" />
          </div>
        ) : (
          <div
            className="w-8 h-8 rounded-full bg-zinc-950 border-2 border-zinc-800 text-zinc-500 flex items-center justify-center group-hover/row:border-zinc-700 group-hover/row:text-zinc-300 transition-colors"
            title="Chưa bắt đầu"
          >
            <span className="text-xs font-semibold">{idx + 1}</span>
          </div>
        )}
      </div>

      {/* ── Main card container ── */}
      <div
        className={`flex-1 flex items-center gap-3 rounded-2xl border p-3.5 transition-all duration-300 relative overflow-hidden backdrop-blur-sm
          ${isDragging
            ? 'border-cyan-500/65 bg-cyan-950/40 shadow-lg shadow-cyan-500/15 scale-[1.01] rotate-[0.5deg] z-50 opacity-95'
            : lesson.isCompleted
              ? 'border-emerald-500/15 bg-emerald-500/5 hover:bg-emerald-500/10 hover:border-emerald-500/25'
              : isCurrent
                ? 'border-cyan-500/30 bg-cyan-950/5 hover:bg-cyan-950/15 hover:border-cyan-500/45 shadow-[0_0_15px_rgba(6,182,212,0.05)]'
                : 'border-zinc-800 bg-zinc-900/60 hover:bg-zinc-800/60 hover:border-zinc-750'
          }`}
      >
        {/* Left glow for active step */}
        {isCurrent && !isDragging && (
          <div className="absolute left-0 top-0 bottom-0 w-1 bg-cyan-500" />
        )}

        {/* Drag Handle */}
        <div
          className="flex-shrink-0 cursor-grab active:cursor-grabbing text-zinc-650 hover:text-zinc-400 p-1.5 rounded-lg hover:bg-zinc-800/40 transition-colors touch-none"
          {...attributes}
          {...listeners}
          title="Kéo thả để đổi thứ tự"
        >
          <GripVertical size={15} />
        </div>

        {/* Title — Inline Edit */}
        <div className="flex-1 min-w-0" onDoubleClick={startEdit}>
          {isEditing ? (
            <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
              <input
                ref={inputRef}
                value={editValue}
                onChange={e => setEditValue(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') void saveEdit();
                  if (e.key === 'Escape') cancelEdit();
                }}
                className="flex-1 bg-zinc-800 border border-cyan-500/40 rounded-xl px-3 py-1.5 text-sm text-zinc-100 outline-none focus:border-cyan-450 min-w-0 focus:ring-1 focus:ring-cyan-500/20"
                disabled={isSaving}
              />
              <button
                onClick={() => void saveEdit()}
                disabled={isSaving}
                className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white disabled:opacity-50 transition-colors"
                title="Lưu"
              >
                {isSaving ? <Loader2 size={12} className="animate-spin" /> : <span className="text-xs font-bold">✓</span>}
              </button>
              <button
                onClick={cancelEdit}
                className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-xl text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
                title="Hủy"
              >
                <X size={13} />
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-1 w-full">
              <button
                onClick={() => onNavigate(String(lesson.id))}
                className="w-full text-left focus:outline-none group/title"
              >
                <p
                  className={`text-sm truncate leading-snug group-hover/title:text-cyan-300 transition-colors ${lesson.isCompleted ? 'text-emerald-250/90 line-through' : 'text-zinc-200 font-semibold'}`}
                >
                  {lesson.title}
                </p>
              </button>
              
              {/* Badges container */}
              <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                {lesson.isCompleted ? (
                  <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-md text-[10px] flex items-center gap-1 font-medium">
                    Đã hoàn thành
                  </span>
                ) : (
                  <span className="bg-zinc-800 text-zinc-450 border border-zinc-700/50 px-2 py-0.5 rounded-md text-[10px] flex items-center gap-1 font-medium">
                    Chưa bắt đầu
                  </span>
                )}

                {/* Quiz Badge */}
                {lesson.quizPassed ? (
                  <span className="bg-violet-500/10 text-violet-400 border border-violet-500/20 px-2 py-0.5 rounded-md text-[10px] flex items-center gap-1 font-medium">
                    <Trophy size={10} /> Đã qua Quiz
                  </span>
                ) : null}

                {/* Flashcard Badge */}
                {lesson.flashcardCompleted ? (
                  <span className="bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 px-2 py-0.5 rounded-md text-[10px] flex items-center gap-1 font-medium">
                    <Brain size={10} /> Thuộc Flashcards
                  </span>
                ) : null}
              </div>
            </div>
          )}
        </div>

        {/* Actions — visible on hover (desktop) or always (mobile) */}
        {!isEditing && (
          <div className="flex items-center gap-1 opacity-100 md:opacity-0 md:group-hover/row:opacity-100 transition-opacity flex-shrink-0 pl-2">
            <button
              onClick={startEdit}
              title="Đổi tên bước"
              className="w-7 h-7 flex items-center justify-center rounded-xl text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
            >
              <Pencil size={13} />
            </button>
            <button
              onClick={() => onNavigate(String(lesson.id))}
              title="Vào Không Gian Học"
              className="w-7 h-7 flex items-center justify-center rounded-xl text-zinc-500 hover:text-cyan-350 hover:bg-cyan-500/10 transition-colors"
            >
              <ArrowRight size={13} />
            </button>
            <button
              onClick={() => onDelete(Number(lesson.id))}
              title="Xóa bước này"
              className="w-7 h-7 flex items-center justify-center rounded-xl text-zinc-650 hover:text-red-400 hover:bg-red-500/10 transition-colors"
            >
              <Trash2 size={13} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Add Lesson Input Row
// ─────────────────────────────────────────────────────────────────────────────

interface AddLessonRowProps {
  roadmapId: number;
  onAdd: (title: string) => Promise<void>;
}

function AddLessonRow({ roadmapId, onAdd }: AddLessonRowProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [value, setValue] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const open = () => {
    setIsOpen(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const save = async () => {
    const trimmed = value.trim();
    if (!trimmed || trimmed.length < 3) return;
    setIsSaving(true);
    try {
      await onAdd(trimmed);
      setValue('');
      setIsOpen(false);
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) {
    return (
      <button
        onClick={open}
        className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-2xl border-2 border-dashed border-zinc-800 hover:border-cyan-500/40 bg-zinc-900/10 hover:bg-cyan-950/5 text-zinc-500 hover:text-cyan-400 transition-all duration-300 text-sm font-semibold group cursor-pointer"
      >
        <Plus size={15} className="group-hover:scale-110 transition-transform" />
        Thêm bước học mới vào lộ trình
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-2xl p-2.5 backdrop-blur-sm">
      <input
        ref={inputRef}
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') void save();
          if (e.key === 'Escape') { setIsOpen(false); setValue(''); }
        }}
        placeholder="Tên bước học mới (ví dụ: 'Tìm hiểu về thuật toán BFS/DFS')..."
        className="flex-1 bg-zinc-850 border border-zinc-800 rounded-xl px-3.5 py-2 text-sm text-zinc-105 outline-none focus:border-cyan-550 placeholder:text-zinc-600"
        disabled={isSaving}
      />
      <button
        onClick={() => void save()}
        disabled={isSaving || value.trim().length < 3}
        className="flex-shrink-0 flex items-center gap-1 px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white text-sm font-semibold transition-colors"
      >
        {isSaving ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
        Thêm
      </button>
      <button
        onClick={() => { setIsOpen(false); setValue(''); }}
        className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-xl text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
      >
        <X size={15} />
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Roadmap Page
// ─────────────────────────────────────────────────────────────────────────────

const AI_GENERATION_STEPS = [
  'Đang kết nối với AI NEXL...',
  'Phân tích Kho Kiến Thức cá nhân...',
  'Áp dụng thang đo nhận thức Bloom...',
  'Tổ chức các khái niệm thành Vi-bài học (Micro-lessons)...',
  'Tối ưu hóa trình tự sắp xếp các bước học...',
  'Đang hoàn tất lộ trình học tập tối ưu dành riêng cho bạn...',
];

export default function RoadmapPage() {
  const navigate = useNavigate();

  // State
  const [roadmaps, setRoadmaps] = useState<MyRoadmap[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Create form panel state
  const [showCreate, setShowCreate] = useState(false);
  const [goalInput, setGoalInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [aiStepIndex, setAiStepIndex] = useState(0);

  // Inline rename roadmap
  const [renamingRoadmapId, setRenamingRoadmapId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [isRenamingRoadmap, setIsRenamingRoadmap] = useState(false);

  // Draft mode
  const [draftRoadmapIds, setDraftRoadmapIds] = useState<Set<number>>(new Set());

  // Sorted lessons per roadmap
  const [lessonOrderMap, setLessonOrderMap] = useState<Record<number, MyRoadmapLesson[]>>({});

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Cycle through AI steps during generation
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isGenerating) {
      setAiStepIndex(0);
      interval = setInterval(() => {
        setAiStepIndex(prev => (prev + 1) % AI_GENERATION_STEPS.length);
      }, 3500);
    }
    return () => clearInterval(interval);
  }, [isGenerating]);

  // Load roadmaps
  const fetchRoadmaps = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const data = await getMyRoadmaps();
      setRoadmaps(data);
      if (data.length > 0 && selectedId === null) {
        setSelectedId(data[0].roadmapId);
      }
      const orderMap: Record<number, MyRoadmapLesson[]> = {};
      for (const rm of data) {
        orderMap[rm.roadmapId] = rm.weeks.flatMap(w => w.lessons);
      }
      setLessonOrderMap(orderMap);
    } catch {
      setLoadError('Không thể tải danh sách lộ trình. Vui lòng thử lại.');
    } finally {
      setIsLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    void fetchRoadmaps();
  }, []);

  const selectedRoadmap = roadmaps.find(rm => rm.roadmapId === selectedId) ?? null;
  const selectedLessons = selectedId ? (lessonOrderMap[selectedId] ?? []) : [];
  const completedCount = selectedLessons.filter(l => l.isCompleted).length;
  const progressPercent = selectedLessons.length > 0 ? Math.round((completedCount / selectedLessons.length) * 100) : 0;
  const firstIncompleteIndex = selectedLessons.findIndex(l => !l.isCompleted);
  const firstIncompleteLesson = selectedLessons.find(l => !l.isCompleted);

  // Resume learning click handler
  const handleResumeLearning = () => {
    if (firstIncompleteLesson) {
      navigate(`/learn/${firstIncompleteLesson.id}`);
    } else if (selectedLessons.length > 0) {
      navigate(`/learn/${selectedLessons[0].id}`);
    }
  };

  // Generate new roadmap
  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    const goal = goalInput.trim();
    if (!goal || goal.length < 3 || isGenerating) return;
    setGenerateError(null);
    setIsGenerating(true);
    try {
      await generateRoadmap(goal);
      const data = await getMyRoadmaps();
      setRoadmaps(data);
      const orderMap: Record<number, MyRoadmapLesson[]> = {};
      for (const rm of data) {
        orderMap[rm.roadmapId] = rm.weeks.flatMap(w => w.lessons);
      }
      setLessonOrderMap(orderMap);
      if (data.length > 0) {
        const newest = data[0];
        setSelectedId(newest.roadmapId);
        setDraftRoadmapIds(prev => new Set([...prev, newest.roadmapId]));
      }
      setGoalInput('');
      setShowCreate(false);
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : 'Không thể tạo lộ trình lúc này.');
    } finally {
      setIsGenerating(false);
    }
  };

  // Delete roadmap
  const handleDeleteRoadmap = async (roadmapId: number) => {
    if (!window.confirm('Xóa lộ trình này sẽ xóa toàn bộ các bước học liên quan. Bạn chắc chắn chứ?')) return;
    try {
      await deleteRoadmap(roadmapId);
      const next = roadmaps.filter(rm => rm.roadmapId !== roadmapId);
      setRoadmaps(next);
      setDraftRoadmapIds(prev => {
        const s = new Set(prev);
        s.delete(roadmapId);
        return s;
      });
      if (selectedId === roadmapId) {
        setSelectedId(next[0]?.roadmapId ?? null);
      }
    } catch {
      /* silent */
    }
  };

  // Rename roadmap
  const startRenameRoadmap = (rm: MyRoadmap) => {
    setRenamingRoadmapId(rm.roadmapId);
    setRenameValue(rm.title);
  };

  const saveRenameRoadmap = async () => {
    if (!renamingRoadmapId) return;
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed.length < 3) {
      setRenamingRoadmapId(null);
      return;
    }
    setIsRenamingRoadmap(true);
    try {
      const updated = await renameRoadmap(renamingRoadmapId, trimmed);
      setRoadmaps(prev =>
        prev.map(rm => (rm.roadmapId === renamingRoadmapId ? { ...rm, title: updated.title } : rm))
      );
    } finally {
      setIsRenamingRoadmap(false);
      setRenamingRoadmapId(null);
    }
  };

  // Rename lesson
  const handleRenameLesson = async (lessonId: number, newTitle: string) => {
    await renameLessonTitle(lessonId, newTitle);
    setLessonOrderMap(prev => {
      if (!selectedId) return prev;
      return {
        ...prev,
        [selectedId]: (prev[selectedId] ?? []).map(l =>
          Number(l.id) === lessonId ? { ...l, title: newTitle } : l
        ),
      };
    });
  };

  // Delete lesson
  const handleDeleteLesson = async (lessonId: number) => {
    await deleteLessonFromRoadmap(lessonId);
    setLessonOrderMap(prev => {
      if (!selectedId) return prev;
      return {
        ...prev,
        [selectedId]: (prev[selectedId] ?? []).filter(l => Number(l.id) !== lessonId),
      };
    });
  };

  // Add lesson
  const handleAddLesson = async (title: string) => {
    if (!selectedId) return;
    const result = await addLessonToRoadmap(selectedId, title);
    const newLesson: MyRoadmapLesson = {
      id: String(result.lessonId),
      title: result.title,
      isCompleted: false,
      quizPassed: false,
      flashcardCompleted: false,
    };
    setLessonOrderMap(prev => ({
      ...prev,
      [selectedId]: [...(prev[selectedId] ?? []), newLesson],
    }));
  };

  // Drag & Drop reorder
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !selectedId) return;

    const lessons = lessonOrderMap[selectedId] ?? [];
    const oldIndex = lessons.findIndex(l => l.id === active.id);
    const newIndex = lessons.findIndex(l => l.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(lessons, oldIndex, newIndex);
    setLessonOrderMap(prev => ({ ...prev, [selectedId]: reordered }));

    const updatesNeeded = reordered
      .map((lesson, idx) => ({ lesson, position: idx + 1 }))
      .filter(({ lesson, position }) => {
        const orig = lessons.find(l => l.id === lesson.id);
        return orig !== undefined && position !== lessons.indexOf(orig) + 1;
      });

    await Promise.allSettled(
      updatesNeeded.map(({ lesson, position }) =>
        reorderLesson(Number(lesson.id), position, 1)
      )
    );
  };

  return (
    <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
      {/* ── Page Header ── */}
      <motion.div
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-zinc-800"
      >
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-cyan-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <Target size={24} className="text-white animate-pulse" />
          </div>
          <div>
            <h1 className="text-2xl text-white font-extrabold tracking-tight">Lộ Trình Học Tập</h1>
            <p className="text-zinc-400 text-sm">AI phác thảo định hướng, bạn toàn quyền tùy chỉnh</p>
          </div>
        </div>
      </motion.div>

      {/* ── Responsive Layout container ── */}
      <div className="flex flex-col lg:flex-row gap-6">
        
        {/* ── Mobile Roadmap Selector ── */}
        <div className="block lg:hidden w-full space-y-4">
          <div className="flex gap-2 overflow-x-auto pb-2 -mx-4 px-4 scrollbar-none">
            {/* Create button pill */}
            <button
              onClick={() => setShowCreate(v => !v)}
              className={`flex-shrink-0 flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold border transition-all duration-300
                ${showCreate
                  ? 'bg-cyan-600 border-cyan-500 text-white shadow-lg shadow-cyan-500/25'
                  : 'bg-zinc-900 border-zinc-850 text-zinc-400 hover:text-zinc-200'
                }`}
            >
              <Plus size={14} />
              Tạo mới
            </button>

            {/* List of pills */}
            {roadmaps.map(rm => {
              const total = lessonOrderMap[rm.roadmapId]?.length ?? 0;
              const completed = lessonOrderMap[rm.roadmapId]?.filter(l => l.isCompleted).length ?? 0;
              const displayPct = total > 0 ? Math.round((completed / total) * 100) : 0;

              return (
                <div
                  key={rm.roadmapId}
                  onClick={() => setSelectedId(rm.roadmapId)}
                  className={`flex-shrink-0 flex items-center gap-2.5 px-4 py-2.5 rounded-xl border text-sm font-semibold transition-all cursor-pointer
                    ${selectedId === rm.roadmapId
                      ? 'bg-cyan-500/20 border-cyan-500/30 text-cyan-300 shadow-[0_0_12px_rgba(6,182,212,0.15)]'
                      : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:bg-zinc-850 hover:text-zinc-300'
                    }`}
                >
                  {renamingRoadmapId === rm.roadmapId ? (
                    <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={e => setRenameValue(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') void saveRenameRoadmap();
                          if (e.key === 'Escape') setRenamingRoadmapId(null);
                        }}
                        className="bg-zinc-850 border border-cyan-500/40 rounded-lg px-2 py-0.5 text-xs text-zinc-100 outline-none w-28"
                        disabled={isRenamingRoadmap}
                      />
                      <button
                        onClick={() => void saveRenameRoadmap()}
                        disabled={isRenamingRoadmap}
                        className="w-5 h-5 flex items-center justify-center rounded bg-cyan-600 text-white disabled:opacity-50"
                      >
                        {isRenamingRoadmap ? <Loader2 size={10} className="animate-spin" /> : <span>✓</span>}
                      </button>
                    </div>
                  ) : (
                    <>
                      <span>{rm.title}</span>
                      <span className="text-[10px] bg-zinc-950 border border-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded">
                        {displayPct}%
                      </span>
                      {selectedId === rm.roadmapId && (
                        <div className="flex items-center gap-1 pl-1.5 border-l border-zinc-800">
                          <button
                            onClick={e => { e.stopPropagation(); startRenameRoadmap(rm); }}
                            className="p-0.5 text-zinc-500 hover:text-zinc-200"
                            title="Đổi tên"
                          >
                            <Pencil size={11} />
                          </button>
                          <button
                            onClick={e => { e.stopPropagation(); void handleDeleteRoadmap(rm.roadmapId); }}
                            className="p-0.5 text-zinc-650 hover:text-red-400"
                            title="Xóa lộ trình"
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {/* Mobile Generator Form */}
          <AnimatePresence>
            {showCreate && (
              <motion.form
                onSubmit={e => void handleGenerate(e)}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 space-y-3 overflow-hidden shadow-xl"
              >
                <div className="flex items-center gap-2">
                  <Wand2 size={15} className="text-cyan-400" />
                  <span className="text-xs text-zinc-300 font-semibold uppercase tracking-wider">Mục tiêu của bạn là gì?</span>
                </div>
                <textarea
                  value={goalInput}
                  onChange={e => setGoalInput(e.target.value)}
                  placeholder='Ví dụ: "Tôi muốn tự học phát triển Web với React và Node.js từ con số không"'
                  rows={3}
                  disabled={isGenerating}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-sm text-zinc-205 placeholder:text-zinc-650 resize-none outline-none focus:border-cyan-500/50 transition-colors disabled:opacity-60"
                />
                {generateError && (
                  <p className="text-xs text-red-400">{generateError}</p>
                )}
                <button
                  type="submit"
                  disabled={goalInput.trim().length < 3 || isGenerating}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white text-sm font-semibold transition-all duration-300 shadow-md shadow-cyan-600/15"
                >
                  {isGenerating ? (
                    <><Loader2 size={14} className="animate-spin" /> Đang thiết lập...</>
                  ) : (
                    <><Sparkles size={14} /> Phác thảo với AI</>
                  )}
                </button>
                {isGenerating && (
                  <div className="mt-2 p-2 bg-cyan-950/20 rounded-lg border border-cyan-500/10">
                    <p className="text-[11px] text-cyan-300 text-center animate-pulse">
                      {AI_GENERATION_STEPS[aiStepIndex]}
                    </p>
                  </div>
                )}
              </motion.form>
            )}
          </AnimatePresence>
        </div>

        {/* ── Desktop Sidebar: Roadmap list ── */}
        <motion.div
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          className="hidden lg:flex flex-col w-72 flex-shrink-0 space-y-4"
        >
          {/* Create button */}
          <button
            id="roadmap-create-btn"
            onClick={() => setShowCreate(v => !v)}
            className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-2xl text-sm font-bold transition-all duration-300 shadow-lg border
              ${showCreate
                ? 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                : 'bg-cyan-600 border-cyan-500 hover:bg-cyan-500 text-white shadow-cyan-500/10 hover:shadow-cyan-500/20'
              }`}
          >
            {showCreate ? (
              <>
                <X size={15} />
                Đóng bảng tạo mới
              </>
            ) : (
              <>
                <Plus size={15} />
                Tạo lộ trình mới
              </>
            )}
          </button>

          {/* Generate Form */}
          <AnimatePresence>
            {showCreate && (
              <motion.form
                id="roadmap-generate-form"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                onSubmit={e => void handleGenerate(e)}
                className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 space-y-4 overflow-hidden backdrop-blur-sm shadow-md"
              >
                <div className="flex items-center gap-2">
                  <Wand2 size={15} className="text-cyan-400" />
                  <span className="text-xs text-zinc-300 font-bold uppercase tracking-wider">Mục tiêu của bạn</span>
                </div>
                <textarea
                  value={goalInput}
                  onChange={e => setGoalInput(e.target.value)}
                  placeholder='Ví dụ: "Học cấu trúc dữ liệu và giải thuật để chuẩn bị đi phỏng vấn"'
                  rows={3}
                  disabled={isGenerating}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-sm text-zinc-200 placeholder:text-zinc-600 resize-none outline-none focus:border-cyan-500/50 transition-colors disabled:opacity-60"
                />
                {generateError && (
                  <p className="text-xs text-red-400">{generateError}</p>
                )}
                <button
                  type="submit"
                  disabled={goalInput.trim().length < 3 || isGenerating}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white text-sm font-bold transition-all shadow-md shadow-cyan-600/10"
                >
                  {isGenerating ? (
                    <><Loader2 size={14} className="animate-spin" /> Đang tạo...</>
                  ) : (
                    <><Sparkles size={14} /> Phác thảo với AI</>
                  )}
                </button>
                {isGenerating && (
                  <div className="mt-2 p-2 bg-cyan-950/20 rounded-xl border border-cyan-500/10">
                    <p className="text-[11px] text-cyan-300 text-center animate-pulse min-h-[1.5rem] flex items-center justify-center">
                      {AI_GENERATION_STEPS[aiStepIndex]}
                    </p>
                  </div>
                )}
              </motion.form>
            )}
          </AnimatePresence>

          {/* Desktop list */}
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={20} className="text-cyan-400 animate-spin" />
            </div>
          ) : loadError ? (
            <p className="text-xs text-red-400 text-center py-4">{loadError}</p>
          ) : roadmaps.length === 0 ? (
            <div className="text-center py-10 bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
              <Compass size={28} className="text-zinc-750 mx-auto mb-2" />
              <p className="text-sm text-zinc-500 font-semibold">Chưa có lộ trình nào</p>
              <p className="text-xs text-zinc-600 mt-1">AI NEXL đã sẵn sàng phác thảo lộ trình học đầu tiên cho bạn!</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[calc(100vh-16rem)] overflow-y-auto pr-1">
              {roadmaps.map(rm => {
                const total = lessonOrderMap[rm.roadmapId]?.length ?? 0;
                const completed = lessonOrderMap[rm.roadmapId]?.filter(l => l.isCompleted).length ?? 0;
                const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

                return (
                  <div
                    key={rm.roadmapId}
                    className={`group rounded-2xl border transition-all duration-300 cursor-pointer relative overflow-hidden
                      ${selectedId === rm.roadmapId
                        ? 'border-cyan-500/30 bg-cyan-500/10 shadow-md shadow-cyan-500/5'
                        : 'border-zinc-800 bg-zinc-900 hover:border-zinc-700/60 hover:bg-zinc-805/60'
                      }`}
                  >
                    {/* Left active line indicator */}
                    {selectedId === rm.roadmapId && (
                      <div className="absolute left-0 top-0 bottom-0 w-1 bg-cyan-500" />
                    )}

                    {renamingRoadmapId === rm.roadmapId ? (
                      <div className="flex items-center gap-1.5 p-3" onClick={e => e.stopPropagation()}>
                        <input
                          autoFocus
                          value={renameValue}
                          onChange={e => setRenameValue(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') void saveRenameRoadmap();
                            if (e.key === 'Escape') setRenamingRoadmapId(null);
                          }}
                          className="flex-1 bg-zinc-800 border border-cyan-500/40 rounded-xl px-2.5 py-1 text-xs text-zinc-100 outline-none min-w-0"
                          disabled={isRenamingRoadmap}
                        />
                        <button
                          onClick={() => void saveRenameRoadmap()}
                          disabled={isRenamingRoadmap}
                          className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded bg-cyan-600 text-white disabled:opacity-50"
                        >
                          {isRenamingRoadmap ? <Loader2 size={10} className="animate-spin" /> : <span>✓</span>}
                        </button>
                        <button
                          onClick={() => setRenamingRoadmapId(null)}
                          className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
                        >
                          <X size={10} />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setSelectedId(rm.roadmapId)}
                        className="w-full text-left p-3.5 flex flex-col gap-2 focus:outline-none"
                      >
                        <div className="flex items-start justify-between gap-2 w-full">
                          <div className="min-w-0 flex-1">
                            <p
                              className={`text-sm truncate transition-colors ${selectedId === rm.roadmapId ? 'text-cyan-300 font-bold' : 'text-zinc-200 font-semibold'}`}
                            >
                              {rm.title}
                            </p>
                          </div>
                          
                          {/* Actions on hover */}
                          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 -mt-1">
                            <button
                              onClick={e => { e.stopPropagation(); startRenameRoadmap(rm); }}
                              className="w-5 h-5 flex items-center justify-center rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
                              title="Đổi tên"
                            >
                              <Pencil size={11} />
                            </button>
                            <button
                              onClick={e => { e.stopPropagation(); void handleDeleteRoadmap(rm.roadmapId); }}
                              className="w-5 h-5 flex items-center justify-center rounded text-zinc-650 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                              title="Xóa lộ trình"
                            >
                              <Trash2 size={11} />
                            </button>
                          </div>
                        </div>

                        <p className="text-xs text-zinc-500 line-clamp-1">{rm.goal}</p>
                        
                        {/* Progress display in card footer */}
                        <div className="mt-1 w-full space-y-1">
                          <div className="flex justify-between items-center text-[10px] text-zinc-500">
                            <span>Tiến độ</span>
                            <span className="font-semibold">{completed}/{total} bài ({pct}%)</span>
                          </div>
                          <div className="w-full h-1 bg-zinc-800 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-300 ${pct === 100 ? 'bg-emerald-500' : 'bg-cyan-500'}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </motion.div>

        {/* ── Right Panel: Selected Roadmap Workspace ── */}
        <motion.div
          initial={{ opacity: 0, x: 10 }}
          animate={{ opacity: 1, x: 0 }}
          className="flex-1 min-w-0"
        >
          {!selectedRoadmap ? (
            <div className="flex flex-col items-center justify-center py-16 px-6 text-center border border-zinc-800 bg-zinc-900 rounded-2xl min-h-[350px]">
              <div className="w-16 h-16 rounded-2xl bg-zinc-950 flex items-center justify-center text-zinc-650 mb-4 border border-zinc-800">
                <Target size={32} />
              </div>
              <h3 className="text-lg text-zinc-350 font-bold">Chưa chọn lộ trình</h3>
              <p className="text-sm text-zinc-500 mt-2 max-w-sm leading-relaxed">
                Vui lòng chọn một lộ trình hiện có bên trái, hoặc tạo một lộ trình mới cùng AI bằng cách nhấn nút phía trên.
              </p>
              <button
                onClick={() => setShowCreate(true)}
                className="mt-5 flex items-center gap-2 px-5 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-semibold text-sm transition-all shadow-md shadow-cyan-600/10 hover:shadow-cyan-600/25"
              >
                <Sparkles size={14} />
                Phác thảo Lộ trình mới với AI
              </button>
            </div>
          ) : (
            <div className="space-y-5">
              
              {/* Premium Header Card (matches dashboard and project styles) */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-zinc-900 border border-zinc-800 rounded-2xl p-5 shadow-md relative overflow-hidden">
                <div className="col-span-1 md:col-span-2 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 px-2 py-0.5 rounded-md font-semibold tracking-wider uppercase">
                      Lộ trình học tập
                    </span>
                    {draftRoadmapIds.has(selectedRoadmap.roadmapId) && (
                      <span className="text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded-md font-semibold tracking-wider uppercase">
                        Bản nháp AI
                      </span>
                    )}
                  </div>
                  <h2 className="text-xl text-white font-extrabold tracking-tight">
                    {selectedRoadmap.title}
                  </h2>
                  <p className="text-xs text-zinc-400 flex items-center gap-1.5 leading-relaxed">
                    <Target size={12} className="text-cyan-400 flex-shrink-0" />
                    <span className="truncate">{selectedRoadmap.goal}</span>
                  </p>
                </div>

                <div className="flex flex-col justify-between items-stretch md:items-end gap-3.5 pt-3 md:pt-0 border-t md:border-t-0 md:border-l border-zinc-800 md:pl-4">
                  <div className="flex md:flex-col justify-between items-center md:items-end gap-1">
                    <span className="text-xs text-zinc-550">Hoàn thành</span>
                    <span className="text-sm text-zinc-300 font-extrabold">
                      {completedCount} / {selectedLessons.length} bài học ({progressPercent}%)
                    </span>
                  </div>

                  {selectedLessons.length > 0 && (
                    <button
                      onClick={handleResumeLearning}
                      className="flex items-center justify-center gap-2 px-4.5 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-sm shadow-lg shadow-cyan-600/15 hover:scale-[1.02] active:scale-[0.98] transition-all duration-350"
                    >
                      <BookOpen size={15} />
                      {completedCount === selectedLessons.length ? 'Xem lại bài học' : 'Học tiếp bước này'}
                    </button>
                  )}
                </div>

                {/* Visual progress line (Solid color bar, no gradients) */}
                <div className="col-span-1 md:col-span-3 pt-3">
                  <div className="w-full h-1.5 bg-zinc-950 border border-zinc-850 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-cyan-550 rounded-full transition-all duration-500"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Draft Mode Banner (Solid bg, no gradients) */}
              <AnimatePresence>
                {draftRoadmapIds.has(selectedRoadmap.roadmapId) && (
                  <motion.div
                    id="roadmap-draft-banner"
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="flex items-start gap-3.5 rounded-2xl border border-cyan-500/20 bg-zinc-900 px-4.5 py-4 shadow-xl backdrop-blur-sm"
                  >
                    <div className="w-8 h-8 rounded-xl bg-cyan-500/10 flex items-center justify-center text-cyan-400 flex-shrink-0 border border-cyan-500/20">
                      <Sparkles size={15} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-zinc-150 font-bold">Bản nháp Lộ trình AI đề xuất</p>
                      <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                        Hãy xem qua, kéo thả các thẻ bài học để sắp xếp lại thứ tự, nhấn vào tên để chỉnh sửa, thêm bài học mới hoặc xóa những phần bạn thấy không phù hợp. Lộ trình là của bạn!
                      </p>
                    </div>
                    <button
                      onClick={() =>
                        setDraftRoadmapIds(prev => {
                          const s = new Set(prev);
                          s.delete(selectedRoadmap.roadmapId);
                          return s;
                        })
                      }
                      className="flex-shrink-0 text-zinc-500 hover:text-white p-1 rounded-lg hover:bg-zinc-800 transition-all"
                      title="Đóng thông báo"
                    >
                      <X size={15} />
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Lesson list container (standard card styling) */}
              <div className="bg-zinc-900 border border-zinc-850 rounded-2xl p-4 sm:p-5 space-y-4 shadow-sm backdrop-blur-sm">
                {selectedLessons.length === 0 ? (
                  <div className="text-center py-12">
                    <Target size={32} className="text-zinc-750 mx-auto mb-2.5" />
                    <p className="text-sm text-zinc-500 font-semibold">Lộ trình chưa có bước học nào</p>
                    <p className="text-xs text-zinc-600 mt-1">Hãy thêm bước học đầu tiên ở bảng bên dưới.</p>
                  </div>
                ) : (
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={e => void handleDragEnd(e)}
                  >
                    {/* The timeline track vertical line, mathematically aligned with circles (Solid zinc track, no gradients) */}
                    <div className="relative space-y-3.5 pl-0 before:absolute before:top-6 before:bottom-6 before:left-[15px] before:w-[2px] before:bg-zinc-800">
                      <SortableContext
                        items={selectedLessons.map(l => l.id)}
                        strategy={verticalListSortingStrategy}
                      >
                        {selectedLessons.map((lesson, idx) => (
                          <SortableLessonCard
                            key={lesson.id}
                            lesson={lesson}
                            idx={idx}
                            isCurrent={idx === firstIncompleteIndex}
                            roadmapId={selectedRoadmap.roadmapId}
                            onDelete={lessonId => void handleDeleteLesson(lessonId)}
                            onRename={(lessonId, newTitle) => handleRenameLesson(lessonId, newTitle)}
                            onNavigate={lessonId => navigate(`/learn/${lessonId}`)}
                          />
                        ))}
                      </SortableContext>
                    </div>
                  </DndContext>
                )}

                {/* Add lesson row */}
                <div className="pt-2 border-t border-zinc-800/60">
                  <AddLessonRow
                    roadmapId={selectedRoadmap.roadmapId}
                    onAdd={title => handleAddLesson(title)}
                  />
                </div>
              </div>

              {/* Tips footer */}
              <div className="flex flex-col sm:flex-row justify-center items-center gap-4 text-[11px] text-zinc-600">
                <span className="flex items-center gap-1">
                  <GripVertical size={12} /> Kéo thả để sắp xếp lại thứ tự bài học
                </span>
                <span className="hidden sm:inline text-zinc-800">•</span>
                <span className="flex items-center gap-1">
                  <Pencil size={12} /> Double-click tiêu đề để sửa nhanh
                </span>
                <span className="hidden sm:inline text-zinc-800">•</span>
                <span className="flex items-center gap-1">
                  <BookOpen size={12} /> Click bài học để mở Không Gian Học Tập
                </span>
              </div>
              
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
}
