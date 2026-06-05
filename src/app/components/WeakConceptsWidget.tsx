import React, { useEffect, useState } from 'react';
import {
  getWeakConcepts,
  getFSRSReviewSchedule,
  submitFSRSReview,
  WeakConcept,
  FSRSCardSchedule
} from '../../api/learning';
import { Loader2, AlertTriangle, Play, CheckCircle, HelpCircle, Layers, Calendar, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';

export default function WeakConceptsWidget({ onReviewCompleted }: { onReviewCompleted?: () => void }) {
  const [weakConcepts, setWeakConcepts] = useState<WeakConcept[]>([]);
  const [dueCards, setDueCards] = useState<FSRSCardSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Review session state
  const [isReviewing, setIsReviewing] = useState(false);
  const [currentCardIndex, setCurrentCardIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [sessionStartTime, setSessionStartTime] = useState<number>(0);
  const [reviewCount, setReviewCount] = useState(0);

  const loadData = async () => {
    try {
      const [concepts, schedule] = await Promise.all([
        getWeakConcepts(),
        getFSRSReviewSchedule()
      ]);
      setWeakConcepts(concepts);
      setDueCards(schedule);
    } catch (err: any) {
      setError(err.message || 'Không thể tải dữ liệu ôn tập.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const startReviewSession = () => {
    if (dueCards.length === 0) {
      toast.info('Không có thẻ nào cần ôn tập hôm nay!');
      return;
    }
    setIsReviewing(true);
    setCurrentCardIndex(0);
    setShowAnswer(false);
    setSessionStartTime(Date.now());
    setReviewCount(0);
  };

  const handleRateCard = async (rating: number) => {
    const card = dueCards[currentCardIndex];
    const duration = Date.now() - sessionStartTime;

    try {
      await submitFSRSReview(card.cardId, rating, duration);
      setReviewCount(prev => prev + 1);

      if (currentCardIndex < dueCards.length - 1) {
        setCurrentCardIndex(prev => prev + 1);
        setShowAnswer(false);
        setSessionStartTime(Date.now());
      } else {
        // Complete session
        toast.success(`Đã hoàn thành ôn tập ${reviewCount + 1} thẻ ghi nhớ!`);
        setIsReviewing(false);
        setLoading(true);
        await loadData();
        if (onReviewCompleted) onReviewCompleted();
      }
    } catch (err: any) {
      toast.error('Lỗi khi gửi đánh giá: ' + err.message);
    }
  };

  const getRatingLabel = (rating: number) => {
    switch (rating) {
      case 1: return 'Again';
      case 2: return 'Hard';
      case 3: return 'Good';
      case 4: return 'Easy';
      default: return '';
    }
  };

  const getRatingColor = (rating: number) => {
    switch (rating) {
      case 1: return 'bg-red-500/10 hover:bg-red-500/20 text-red-400 border-red-500/20';
      case 2: return 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border-amber-500/20';
      case 3: return 'bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border-cyan-500/20';
      case 4: return 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border-emerald-500/20';
      default: return '';
    }
  };

  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900/50">
        <Loader2 className="h-8 w-8 animate-spin text-cyan-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-4 text-center">
        <p className="text-xs text-red-400">{error}</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {/* 1. Weak Concepts list */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5 backdrop-blur">
        <div className="flex items-center gap-2 mb-4">
          <AlertTriangle className="text-amber-500" size={18} />
          <h4 className="text-white font-bold text-sm">Điểm yếu cần lưu ý ({weakConcepts.length})</h4>
        </div>

        {weakConcepts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-zinc-500 text-xs">
            <CheckCircle className="text-cyan-500 mb-2" size={24} />
            <span>Tuyệt vời! Bạn không có khái niệm nào bị yếu.</span>
          </div>
        ) : (
          <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
            {weakConcepts.slice(0, 5).map(concept => (
              <div
                key={concept.tagId}
                className="flex items-center justify-between p-3 rounded-xl border border-zinc-800 bg-zinc-950/40"
              >
                <div>
                  <p className="text-sm text-zinc-200 font-semibold">{concept.name}</p>
                  <p className="text-xs text-zinc-500 mt-0.5">{concept.cardCount} thẻ liên quan</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-zinc-500">Mức độ yếu:</span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded font-bold ${
                      concept.weaknessScore > 0.8
                        ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                        : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                    }`}
                  >
                    {Math.round(concept.weaknessScore * 100)}%
                  </span>
                </div>
              </div>
            ))}
            {weakConcepts.length > 5 && (
              <p className="text-center text-xs text-zinc-500 mt-2">
                và {weakConcepts.length - 5} khái niệm yếu khác...
              </p>
            )}
          </div>
        )}
      </div>

      {/* 2. Review Scheduler widget */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-5 backdrop-blur flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Calendar className="text-cyan-400" size={18} />
              <h4 className="text-white font-bold text-sm">Lịch ôn tập thích ứng (FSRS)</h4>
            </div>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 font-semibold border border-cyan-500/20">
              {dueCards.length} thẻ đến hạn
            </span>
          </div>

          <p className="text-xs text-zinc-400 leading-relaxed mb-4">
            NEXL sử dụng thuật toán FSRS để tự động tính toán thời gian phản hồi tốt nhất của bạn, giúp bạn đạt mức ghi nhớ dài hạn tối ưu.
          </p>
        </div>

        <div>
          {dueCards.length > 0 ? (
            <button
              onClick={startReviewSession}
              className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-semibold text-sm transition-all shadow-lg shadow-cyan-600/20 hover:shadow-cyan-600/30"
            >
              <Play size={16} fill="currentColor" /> Ôn tập ngay bây giờ
            </button>
          ) : (
            <div className="p-4 rounded-xl bg-zinc-950/40 border border-zinc-800/80 text-center text-xs text-zinc-500">
              Bạn đã hoàn thành tất cả các thẻ của ngày hôm nay! Hãy quay lại vào ngày mai.
            </div>
          )}
        </div>

        {/* 3. FSRS Review Modal */}
        <AnimatePresence>
          {isReviewing && dueCards.length > 0 && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                className="w-full max-w-lg bg-zinc-950 border border-zinc-800 rounded-2xl overflow-hidden shadow-2xl flex flex-col h-[420px]"
              >
                {/* Header */}
                <div className="p-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/40">
                  <div className="flex items-center gap-2">
                    <Layers size={16} className="text-cyan-400" />
                    <span className="text-xs font-semibold text-zinc-400">
                      Đang ôn tập: {currentCardIndex + 1} / {dueCards.length}
                    </span>
                  </div>
                  <button
                    onClick={() => setIsReviewing(false)}
                    className="text-zinc-500 hover:text-zinc-300 text-xs px-2.5 py-1 rounded-lg border border-zinc-800 hover:bg-zinc-900 transition-colors"
                  >
                    Đóng
                  </button>
                </div>

                {/* Progress bar */}
                <div className="w-full bg-zinc-900 h-1">
                  <div
                    className="bg-cyan-500 h-full transition-all duration-300"
                    style={{ width: `${((currentCardIndex + 1) / dueCards.length) * 100}%` }}
                  />
                </div>

                {/* Main Card View */}
                <div className="flex-1 p-6 flex flex-col justify-between items-center text-center relative">
                  <div className="text-xs text-zinc-500 absolute top-4 left-6 flex items-center gap-1">
                    <span>Nguồn:</span>
                    <span className="font-semibold text-cyan-500/80 max-w-[200px] truncate">
                      {dueCards[currentCardIndex].lessonTitle}
                    </span>
                  </div>

                  <div className="w-full my-auto flex flex-col items-center justify-center min-h-[160px]">
                    {!showAnswer ? (
                      <motion.div
                        key="front"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="text-lg text-white font-medium px-4 leading-relaxed"
                      >
                        {dueCards[currentCardIndex].frontText}
                      </motion.div>
                    ) : (
                      <motion.div
                        key="back"
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="text-base text-zinc-300 px-4 leading-relaxed"
                      >
                        {dueCards[currentCardIndex].backText}
                      </motion.div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="w-full mt-4">
                    {!showAnswer ? (
                      <button
                        onClick={() => setShowAnswer(true)}
                        className="w-full py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white font-semibold text-sm transition-colors border border-zinc-700/50"
                      >
                        Lật thẻ ghi nhớ
                      </button>
                    ) : (
                      <div className="grid grid-cols-4 gap-2">
                        {[1, 2, 3, 4].map(rating => (
                          <button
                            key={rating}
                            onClick={() => handleRateCard(rating)}
                            className={`py-3 rounded-xl border font-semibold text-xs transition-all flex flex-col items-center justify-center gap-1 ${getRatingColor(
                              rating
                            )}`}
                          >
                            <span className="font-bold text-sm">{rating}</span>
                            <span>{getRatingLabel(rating)}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
