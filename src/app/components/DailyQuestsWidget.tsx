import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ClipboardList, Gift } from 'lucide-react';

import { getDailyQuests } from '../../api/gamification';
import { DailyQuestDTO, DailyQuestListResponseDTO } from '../../api/dto';
import { useApp } from '../context/AppContext';

function getDifficultyLabel(difficulty: DailyQuestDTO['difficulty']): string {
  if (difficulty === 'easy') return 'Dễ';
  if (difficulty === 'medium') return 'Trung bình';
  return 'Khó';
}

function getDifficultyTone(difficulty: DailyQuestDTO['difficulty']): string {
  if (difficulty === 'easy') return 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20';
  if (difficulty === 'medium') return 'text-amber-300 bg-amber-500/10 border-amber-500/20';
  return 'text-rose-300 bg-rose-500/10 border-rose-500/20';
}

export default function DailyQuestsWidget() {
  const { gamificationRefreshTick } = useApp();
  const [state, setState] = useState<DailyQuestListResponseDTO | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      setIsLoading(true);
      try {
        const response = await getDailyQuests();
        if (!mounted) return;
        setState(response);
      } catch {
        if (!mounted) return;
        setState(null);
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };

    void load();
    return () => {
      mounted = false;
    };
  }, [gamificationRefreshTick]);

  const completionCount = useMemo(() => {
    if (!state) return 0;
    return state.quests.filter(quest => quest.is_completed).length;
  }, [state]);

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ClipboardList size={20} className="text-cyan-400" />
          <h3 className="text-white text-lg" style={{ fontWeight: 700 }}>Nhiệm vụ hôm nay</h3>
        </div>
        <div className="text-sm text-zinc-300" style={{ fontWeight: 700 }}>
          {completionCount}/2 hoàn thành
        </div>
      </div>

      {isLoading && (
        <div className="mt-5 grid grid-cols-1 lg:grid-cols-2 gap-4">
          {[0, 1].map(item => (
            <div key={item} className="h-[132px] rounded-2xl border border-zinc-800 bg-zinc-950/60 animate-pulse" />
          ))}
        </div>
      )}

      {!isLoading && !state && (
        <div className="mt-4 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          Không tải được nhiệm vụ hôm nay. Vui lòng thử lại sau.
        </div>
      )}

      {!isLoading && state && (
        <div className="mt-5 space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {state.quests.map(quest => {
              const safeTarget = Math.max(1, quest.target_value || 1);
              const safeCurrent = Math.max(0, Math.min(quest.current_progress || 0, safeTarget));
              const progressPercent = Math.min(100, Math.max(0, Math.round((safeCurrent / safeTarget) * 100)));

              return (
                <article
                  key={quest.id}
                  className={`rounded-2xl border px-5 py-4 transition-colors ${quest.is_completed
                    ? 'border-emerald-500/30 bg-emerald-500/10'
                    : 'border-zinc-800 bg-zinc-950/50'}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className={`text-base ${quest.is_completed ? 'text-emerald-200 line-through' : 'text-white'}`} style={{ fontWeight: 700 }}>
                        {quest.title}
                      </p>
                      <div className="mt-2 flex items-center gap-2 text-xs text-zinc-400">
                        <span className={`rounded-md border px-2 py-0.5 ${getDifficultyTone(quest.difficulty)}`}>
                          {getDifficultyLabel(quest.difficulty)}
                        </span>
                        <span className="inline-flex items-center gap-1 text-cyan-300" style={{ fontWeight: 600 }}>
                          <Gift size={12} />+{quest.exp_reward} EXP
                        </span>
                      </div>
                    </div>

                    {quest.is_completed && <CheckCircle2 size={20} className="mt-0.5 text-emerald-400 flex-shrink-0" />}
                  </div>

                  <div className="mt-4">
                    <div className="mb-1.5 flex items-center justify-between text-xs text-zinc-400">
                      <span>Tiến độ</span>
                      <span>{safeCurrent}/{safeTarget}</span>
                    </div>
                    <div className="h-2 rounded-full bg-zinc-800 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${quest.is_completed ? 'bg-emerald-400' : 'bg-cyan-500'}`}
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-200" style={{ fontWeight: 600 }}>
            Hoàn thành cả 2 để giữ vững chuỗi học tập (Streak)!
            {state.all_clear_bonus_exp > 0 && (
              <span className="ml-1 text-cyan-100">Thưởng thêm +{state.all_clear_bonus_exp} EXP khi all-clear.</span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
