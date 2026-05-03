import React from 'react';
import { Flame, RotateCcw } from 'lucide-react';
import { Dialog, DialogContent } from './ui/dialog';

export interface StreakLostModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lostStreak: number;
}

export default function StreakLostModal({ open, onOpenChange, lostStreak }: StreakLostModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!w-[min(100vw-2rem,560px)] !max-w-[560px] border-zinc-800 bg-zinc-950 p-6 text-zinc-100">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-orange-500/30 bg-orange-500/10 text-orange-400">
            <Flame size={18} />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg text-white" style={{ fontWeight: 700 }}>
              Chuỗi học tập đã bị ngắt
            </h2>
            <p className="mt-2 text-sm text-zinc-300">
              Rất tiếc, bạn đã đánh mất chuỗi {lostStreak} ngày. Hãy bắt đầu lại từ đầu nhé!
            </p>
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="inline-flex items-center gap-2 rounded-xl border border-cyan-500/30 bg-cyan-500/15 px-4 py-2 text-sm text-cyan-200 transition-colors hover:bg-cyan-500/25"
            style={{ fontWeight: 600 }}
          >
            <RotateCcw size={14} />
            Bắt đầu lại
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
