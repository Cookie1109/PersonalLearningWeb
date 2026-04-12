import React, { FormEvent, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { useNavigate, useSearchParams } from 'react-router';
import { Loader2, Sparkles, Target, Wand2 } from 'lucide-react';
import { generateRoadmap } from '../../api/learning';

interface RoadmapGeneratorProps {
  onGenerateRoadmap?: (goal: string) => Promise<unknown>;
}

export default function RoadmapGenerator({ onGenerateRoadmap = generateRoadmap }: RoadmapGeneratorProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [inputGoal, setInputGoal] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const trimmedGoal = inputGoal.trim();
  const isGoalTooShort = trimmedGoal.length > 0 && trimmedGoal.length < 3;
  const isGoalTooLong = trimmedGoal.length > 500;

  useEffect(() => {
    const queryGoal = searchParams.get('goal')?.trim();
    if (!queryGoal) return;
    setInputGoal(queryGoal);
  }, [searchParams]);

  const handleGenerate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const goal = trimmedGoal;
    if (!goal || goal.length < 3 || goal.length > 500 || isGenerating) return;

    setGenerateError(null);
    setIsGenerating(true);

    try {
      await onGenerateRoadmap(goal);
      navigate('/lessons', { replace: true });
    } catch (error) {
      if (error instanceof Error) {
        setGenerateError(error.message);
      } else {
        setGenerateError('Không thể tạo lộ trình lúc này. Vui lòng thử lại sau.');
      }
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      <motion.div initial={{ opacity: 0, y: -15 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-violet-600 flex items-center justify-center">
            <Wand2 size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl text-white" style={{ fontWeight: 700 }}>Tạo Lộ Trình Học Tập</h1>
            <p className="text-zinc-500 text-sm">Nhập mục tiêu, AI sẽ biên soạn lộ trình chi tiết cho bạn</p>
          </div>
        </div>
      </motion.div>

      <motion.form
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        onSubmit={handleGenerate}
        className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6"
      >
        <label htmlFor="roadmap-goal" className="block text-sm text-zinc-300 mb-3" style={{ fontWeight: 600 }}>
          <Target size={14} className="inline mr-2 text-violet-400" />
          Mục tiêu học tập của bạn là gì?
        </label>

        <textarea
          id="roadmap-goal"
          value={inputGoal}
          onChange={event => setInputGoal(event.target.value)}
          disabled={isGenerating}
          placeholder='Ví dụ: "Tôi muốn học Python backend để xây API trong 6 tuần"'
          rows={6}
          className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-zinc-200 placeholder:text-zinc-600 resize-y min-h-[160px] outline-none focus:border-violet-500/60 transition-colors text-sm disabled:opacity-70"
        />

        {isGoalTooShort && (
          <p className="mt-2 text-xs text-amber-300">
            Mục tiêu cần ít nhất 3 ký tự để AI tạo lộ trình.
          </p>
        )}

        {isGoalTooLong && (
          <p className="mt-2 text-xs text-amber-300">
            Mục tiêu tối đa 500 ký tự. Vui lòng rút gọn để tiếp tục.
          </p>
        )}

        {isGenerating && (
          <div className="mt-4 rounded-xl border border-violet-500/30 bg-violet-500/10 px-4 py-3 flex items-center gap-3">
            <Loader2 size={16} className="text-violet-300 animate-spin" />
            <p className="text-sm text-violet-100" style={{ fontWeight: 600 }}>
              AI đang biên soạn lộ trình chi tiết. Quá trình này mất khoảng 15-30 giây...
            </p>
          </div>
        )}

        {generateError && (
          <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {generateError}
          </div>
        )}

        <div className="mt-5 flex justify-end">
          <button
            type="submit"
            disabled={!trimmedGoal || isGoalTooShort || isGoalTooLong || isGenerating}
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors text-sm"
            style={{ fontWeight: 600 }}
          >
            {isGenerating ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            {isGenerating ? 'Đang tạo lộ trình...' : 'Tạo lộ trình với AI'}
          </button>
        </div>
      </motion.form>
    </div>
  );
}


