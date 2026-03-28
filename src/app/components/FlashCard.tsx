import React, { useState } from 'react';
import { motion } from 'motion/react';
import { RotateCcw, ChevronLeft, ChevronRight, Check, X, Brain } from 'lucide-react';
import { Flashcard } from '../lib/types';

interface Props {
  cards: Flashcard[];
  onComplete: (known: number, total: number) => void;
  titleFront?: string;
  titleBack?: string;
}

export default function FlashCardDeck({ cards, onComplete, titleFront = 'Câu hỏi · Nhấn để lật', titleBack = 'Đáp án' }: Props) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [known, setKnown] = useState<Set<string>>(new Set());
  const [unknown, setUnknown] = useState<Set<string>>(new Set());
  const [finished, setFinished] = useState(false);

  const current = cards[currentIndex];
  const progress = ((currentIndex) / cards.length) * 100;

  const flip = () => setIsFlipped(f => !f);

  const handleKnow = (knows: boolean) => {
    if (knows) {
      setKnown(prev => new Set([...prev, current.id]));
    } else {
      setUnknown(prev => new Set([...prev, current.id]));
    }

    if (currentIndex < cards.length - 1) {
      setIsFlipped(false);
      setTimeout(() => setCurrentIndex(i => i + 1), 200);
    } else {
      const finalKnown = knows ? known.size + 1 : known.size;
      setTimeout(() => {
        setFinished(true);
        onComplete(finalKnown, cards.length);
      }, 300);
    }
  };

  const restart = () => {
    setCurrentIndex(0);
    setIsFlipped(false);
    setKnown(new Set());
    setUnknown(new Set());
    setFinished(false);
  };

  if (finished) {
    const knownCount = known.size;
    const pct = Math.round((knownCount / cards.length) * 100);
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex flex-col items-center justify-center p-8 text-center space-y-6"
      >
        <div className="w-20 h-20 rounded-full bg-violet-600 flex items-center justify-center">
          <Brain size={36} className="text-white" />
        </div>
        <div>
          <h3 className="text-2xl text-white" style={{ fontWeight: 700 }}>Hoàn thành! 🎉</h3>
          <p className="text-zinc-400 mt-1">Kết quả luyện tập flashcard</p>
        </div>
        <div className="grid grid-cols-2 gap-4 w-full max-w-xs">
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 text-center">
            <p className="text-2xl text-emerald-400" style={{ fontWeight: 700 }}>{knownCount}</p>
            <p className="text-xs text-zinc-400">Đã thuộc</p>
          </div>
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-center">
            <p className="text-2xl text-red-400" style={{ fontWeight: 700 }}>{cards.length - knownCount}</p>
            <p className="text-xs text-zinc-400">Cần ôn thêm</p>
          </div>
        </div>
        <div className="text-4xl" style={{ fontWeight: 700, color: pct >= 80 ? '#10b981' : pct >= 60 ? '#f59e0b' : '#ef4444' }}>
          {pct}%
        </div>
        <div className="flex gap-3">
          <button onClick={restart} className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-zinc-800 text-white hover:bg-zinc-700 transition-colors text-sm" style={{ fontWeight: 600 }}>
            <RotateCcw size={15} />Ôn lại
          </button>
          {unknown.size > 0 && (
            <button onClick={() => {
              setCurrentIndex(0);
              setIsFlipped(false);
              setKnown(new Set());
              setUnknown(new Set());
              setFinished(false);
            }} className="px-6 py-2.5 rounded-xl bg-violet-600 text-white hover:bg-violet-500 transition-colors text-sm" style={{ fontWeight: 600 }}>
              Ôn thẻ chưa thuộc ({unknown.size})
            </button>
          )}
        </div>
      </motion.div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-6 py-4">
      {/* Progress */}
      <div className="w-full space-y-2">
        <div className="flex justify-between text-xs text-zinc-500">
          <span>Thẻ {currentIndex + 1} / {cards.length}</span>
          <div className="flex gap-3">
            <span className="text-emerald-400">✓ {known.size} thuộc</span>
            <span className="text-red-400">✗ {unknown.size} chưa thuộc</span>
          </div>
        </div>
        <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-violet-500 rounded-full"
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>
      </div>

      {/* Card */}
      <div
        className="relative w-full max-w-lg cursor-pointer"
        style={{ perspective: 1000 }}
        onClick={flip}
      >
        <motion.div
          animate={{ rotateY: isFlipped ? 180 : 0 }}
          transition={{ duration: 0.4, ease: 'easeInOut' }}
          style={{ transformStyle: 'preserve-3d' }}
          className="relative w-full"
        >
          {/* Front */}
          <div
            className="w-full min-h-48 bg-zinc-900 border border-zinc-700 rounded-2xl p-8 flex flex-col items-center justify-center text-center"
            style={{ backfaceVisibility: 'hidden' }}
          >
            <div className="text-xs text-violet-400 mb-4 uppercase tracking-wider" style={{ fontWeight: 600 }}>{titleFront}</div>
            <p className="text-white text-lg" style={{ fontWeight: 600 }}>{current?.front}</p>
            <div className="mt-6 flex items-center gap-2 text-xs text-zinc-600">
              <RotateCcw size={12} />
              <span>Nhấn vào thẻ để xem đáp án</span>
            </div>
          </div>

          {/* Back */}
          <div
            className="absolute inset-0 w-full min-h-48 bg-zinc-800 border border-violet-500/40 rounded-2xl p-8 flex flex-col items-center justify-center text-center"
            style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
          >
            <div className="text-xs text-cyan-400 mb-4 uppercase tracking-wider" style={{ fontWeight: 600 }}>{titleBack}</div>
            <p className="text-zinc-200 text-base leading-relaxed">{current?.back}</p>
          </div>
        </motion.div>
      </div>

      {/* Action buttons */}
      <div className={`flex gap-4 transition-opacity duration-300 ${isFlipped ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
        <button
          onClick={() => handleKnow(false)}
          className="flex items-center gap-2 px-8 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 transition-all text-sm"
          style={{ fontWeight: 600 }}
        >
          <X size={16} />Chưa thuộc
        </button>
        <button
          onClick={() => handleKnow(true)}
          className="flex items-center gap-2 px-8 py-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 transition-all text-sm"
          style={{ fontWeight: 600 }}
        >
          <Check size={16} />Đã thuộc
        </button>
      </div>

      {/* Navigation */}
      <div className="flex items-center gap-4 text-zinc-600 text-xs">
        <button
          onClick={() => { if (currentIndex > 0) { setCurrentIndex(i => i - 1); setIsFlipped(false); } }}
          disabled={currentIndex === 0}
          className="flex items-center gap-1 hover:text-zinc-400 disabled:opacity-30 transition-colors"
        >
          <ChevronLeft size={14} />Trước
        </button>
        <div className="flex gap-1">
          {cards.map((_, i) => (
            <div
              key={i}
              className={`w-1.5 h-1.5 rounded-full transition-colors ${
                i === currentIndex ? 'bg-violet-400' :
                known.has(cards[i].id) ? 'bg-emerald-500' :
                unknown.has(cards[i].id) ? 'bg-red-500' :
                'bg-zinc-700'
              }`}
            />
          ))}
        </div>
        <button
          onClick={() => { if (currentIndex < cards.length - 1) { setCurrentIndex(i => i + 1); setIsFlipped(false); } }}
          disabled={currentIndex === cards.length - 1}
          className="flex items-center gap-1 hover:text-zinc-400 disabled:opacity-30 transition-colors"
        >
          Sau<ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}
