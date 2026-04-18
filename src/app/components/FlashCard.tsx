import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { ChevronLeft, ChevronRight, Check, Download, Lightbulb, Loader2, RotateCcw, Sparkles, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { FlashcardStatusDTO } from '../../api/dto';
import { explainFlashcard, generateFlashcards, getFlashcards, updateFlashcardStatus } from '../../api/learning';
import { Flashcard as LegacyFlashcard } from '../lib/types';

interface Props {
  documentId?: string | number;
  cards?: LegacyFlashcard[];
  onComplete?: (known: number, total: number) => void;
  titleFront?: string;
  titleBack?: string;
}

const EMPTY_CARDS: LegacyFlashcard[] = [];

interface DeckCard {
  id: number | string;
  front_text: string;
  back_text: string;
  status: FlashcardStatusDTO;
}

type StudyMode = 'all' | 'missed';

function normalizeStatus(rawStatus: unknown): FlashcardStatusDTO {
  const normalized = String(rawStatus ?? '').trim().toLowerCase();
  if (normalized === 'got_it' || normalized === 'missed_it' || normalized === 'new') {
    return normalized;
  }
  return 'new';
}

function mapLegacyCard(card: LegacyFlashcard): DeckCard {
  return {
    id: card.id,
    front_text: card.front,
    back_text: card.back,
    status: 'new',
  };
}

function escapeCsvField(value: string): string {
  const raw = String(value ?? '');
  if (/[",\n]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

export default function FlashCardDeck({
  documentId,
  cards = EMPTY_CARDS,
  onComplete,
  titleFront = 'Câu hỏi · Nhấn để lật',
  titleBack = 'Đáp án',
}: Props) {
  const isApiMode = documentId !== undefined && documentId !== null;

  const [cardsState, setCardsState] = useState<DeckCard[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [isExplaining, setIsExplaining] = useState(false);
  const [studyMode, setStudyMode] = useState<StudyMode>('all');
  const [error, setError] = useState<string | null>(null);
  const [explainError, setExplainError] = useState<string | null>(null);
  const [explanationByCardId, setExplanationByCardId] = useState<Record<string, string>>({});
  const completeCalledRef = useRef(false);

  const deckCards = useMemo(() => {
    if (studyMode === 'missed') {
      return cardsState.filter(card => card.status === 'missed_it');
    }
    return cardsState;
  }, [cardsState, studyMode]);
  const currentAllCards = cardsState;

  const current = deckCards.length > 0 ? deckCards[currentIndex] ?? null : null;
  const isEndOfDeck = deckCards.length > 0 && currentIndex >= deckCards.length;

  const knownCount = useMemo(
    () => cardsState.filter(card => card.status === 'got_it').length,
    [cardsState]
  );
  const unknownCount = useMemo(
    () => cardsState.filter(card => card.status === 'missed_it').length,
    [cardsState]
  );
  const missedCount = useMemo(
    () => currentAllCards.filter(card => card.status === 'missed_it').length,
    [currentAllCards]
  );
  const progress = deckCards.length > 0
    ? (Math.min(currentIndex + 1, deckCards.length) / deckCards.length) * 100
    : 0;

  const setCardsSafely = useCallback((nextCards: DeckCard[]) => {
    setCardsState(nextCards);
    setStudyMode('all');
    setCurrentIndex(0);
    setIsFlipped(false);
    setError(null);
    setExplainError(null);
  }, []);

  const reportCompleteIfNeeded = useCallback((nextCards: DeckCard[], previousStatus: FlashcardStatusDTO) => {
    if (!onComplete || completeCalledRef.current) {
      return;
    }
    if (previousStatus !== 'new') {
      return;
    }

    const hasUnrated = nextCards.some(card => card.status === 'new');
    if (hasUnrated) {
      return;
    }

    completeCalledRef.current = true;
    onComplete(nextCards.filter(card => card.status === 'got_it').length, nextCards.length);
  }, [onComplete]);

  useEffect(() => {
    completeCalledRef.current = false;
  }, [documentId, cards]);

  useEffect(() => {
    setExplainError(null);
  }, [current?.id, isFlipped]);

  useEffect(() => {
    if (!isApiMode) {
      setCardsSafely(cards.map(mapLegacyCard));
      return;
    }

    let active = true;

    const load = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await getFlashcards(String(documentId));
        if (!active) {
          return;
        }

        const normalizedCards: DeckCard[] = response.map(card => ({
          id: card.id,
          front_text: card.front_text,
          back_text: card.back_text,
          status: normalizeStatus(card.status),
        }));

        setCardsSafely(normalizedCards);
      } catch (loadError) {
        if (!active) {
          return;
        }
        if (loadError instanceof Error) {
          setError(loadError.message);
        } else {
          setError('Không thể tải flashcard lúc này.');
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };

    void load();

    return () => {
      active = false;
    };
  }, [cards, documentId, isApiMode, setCardsSafely]);

  const flip = () => {
    if (!isUpdatingStatus) {
      setIsFlipped(prev => !prev);
    }
  };

  const handleGenerateCards = useCallback(async () => {
    if (!isApiMode || isLoading || isUpdatingStatus) {
      return;
    }

    setIsLoading(true);
    setError(null);
    setExplainError(null);
    completeCalledRef.current = false;

    try {
      const response = await generateFlashcards(String(documentId));
      const normalizedCards: DeckCard[] = response.map(card => ({
        id: card.id,
        front_text: card.front_text,
        back_text: card.back_text,
        status: normalizeStatus(card.status),
      }));

      setCardsSafely(normalizedCards);
    } catch (generationError) {
      if (generationError instanceof Error) {
        setError(generationError.message);
      } else {
        setError('Không thể tạo flashcard lúc này.');
      }
    } finally {
      setIsLoading(false);
    }
  }, [documentId, isApiMode, isLoading, isUpdatingStatus, setCardsSafely]);

  const handleRateCard = useCallback(async (nextStatus: Extract<FlashcardStatusDTO, 'got_it' | 'missed_it'>) => {
    if (!current || isUpdatingStatus || isLoading) {
      return;
    }

    setIsUpdatingStatus(true);
    setError(null);

    try {
      if (isApiMode) {
        await updateFlashcardStatus(current.id, nextStatus);
      }

      const previousStatus = current.status;
      const updatedCards = cardsState.map(card => {
        if (card.id !== current.id) {
          return card;
        }
        return {
          ...card,
          status: nextStatus,
        };
      });

      setCardsState(updatedCards);
      reportCompleteIfNeeded(updatedCards, previousStatus);

      const nextDeckCards = studyMode === 'missed'
        ? updatedCards.filter(card => card.status === 'missed_it')
        : updatedCards;

      const nextIndex = studyMode === 'missed' && nextStatus !== 'missed_it'
        ? currentIndex
        : currentIndex + 1;

      setCurrentIndex(Math.min(nextIndex, nextDeckCards.length));
      setIsFlipped(false);
      setExplainError(null);
    } catch (updateError) {
      if (updateError instanceof Error) {
        setError(updateError.message);
      } else {
        setError('Không thể cập nhật trạng thái flashcard lúc này.');
      }
    } finally {
      setIsUpdatingStatus(false);
    }
  }, [cardsState, current, currentIndex, isApiMode, isLoading, isUpdatingStatus, reportCompleteIfNeeded, studyMode]);

  const handleExplainCurrent = useCallback(async () => {
    if (!current || !isFlipped || isExplaining) {
      return;
    }

    const cardKey = String(current.id);
    if (explanationByCardId[cardKey]) {
      return;
    }

    setIsExplaining(true);
    setExplainError(null);

    try {
      const explanation = isApiMode
        ? await explainFlashcard(current.id)
        : `Giải thích thêm: ${current.back_text}`;

      setExplanationByCardId(prev => ({
        ...prev,
        [cardKey]: explanation.trim(),
      }));
    } catch (explainRequestError) {
      if (explainRequestError instanceof Error) {
        setExplainError(explainRequestError.message);
      } else {
        setExplainError('Không thể tạo giải thích lúc này.');
      }
    } finally {
      setIsExplaining(false);
    }
  }, [current, explanationByCardId, isApiMode, isExplaining, isFlipped]);

  const handleExportCsv = useCallback(() => {
    if (cardsState.length === 0) {
      return;
    }

    const lines: string[] = ['front_text,back_text'];
    for (const card of cardsState) {
      lines.push(`${escapeCsvField(card.front_text)},${escapeCsvField(card.back_text)}`);
    }

    const csvContent = lines.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'flashcards.csv';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }, [cardsState]);

  const restart = () => {
    setCurrentIndex(0);
    setIsFlipped(false);
    setExplainError(null);
  };

  const relearnWrongCards = () => {
    setStudyMode('missed');
    setCurrentIndex(0);
    setIsFlipped(false);
    setExplainError(null);
  };

  const relearnAllCards = () => {
    setStudyMode('all');
    setCurrentIndex(0);
    setIsFlipped(false);
    setExplainError(null);
  };

  const handleResetAll = () => {
    relearnAllCards();
  };

  const currentExplanation = current ? explanationByCardId[String(current.id)] : undefined;

  if (isLoading) {
    return (
      <div className="flex min-h-56 flex-col items-center justify-center gap-3 rounded-2xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-6 text-center">
        <Loader2 size={18} className="animate-spin text-cyan-300" />
        <p className="text-sm text-cyan-100">Đang tải flashcard...</p>
      </div>
    );
  }

  if (cardsState.length === 0) {
    return (
      <div className="rounded-2xl border border-zinc-700 bg-zinc-900/70 px-4 py-5 text-center">
        <p className="text-sm text-zinc-300">
          {isApiMode
            ? 'Tài liệu này chưa có flashcard. Bạn có thể tạo ngay bằng AI.'
            : 'Không có flashcard để hiển thị.'}
        </p>
        {isApiMode && (
          <button
            onClick={() => {
              void handleGenerateCards();
            }}
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-cyan-600 px-4 py-2.5 text-sm text-white hover:bg-cyan-500"
            style={{ fontWeight: 600 }}
          >
            <Sparkles size={15} />Tạo Flashcard bằng AI
          </button>
        )}
        {error && (
          <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        )}
      </div>
    );
  }

  if (deckCards.length === 0 && !isLoading) {
    return (
      <div className="empty-state-container rounded-2xl border border-zinc-700 bg-zinc-900/70 px-4 py-5 text-center">
        <p className="text-sm text-zinc-300">Bạn không có thẻ nào cần học lại. Tất cả đều đã thuộc!</p>
        <button
          onClick={handleResetAll}
          className="mt-4 inline-flex items-center gap-2 rounded-xl bg-cyan-600 px-4 py-2.5 text-sm text-white hover:bg-cyan-500"
          style={{ fontWeight: 600 }}
        >
          <RotateCcw size={14} />Học lại toàn bộ
        </button>
      </div>
    );
  }

  if (isEndOfDeck) {
    return (
      <div className="space-y-4">
        <div className="flex justify-end">
          <button
            onClick={handleExportCsv}
            disabled={cardsState.length === 0}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ fontWeight: 600 }}
          >
            <Download size={13} />Xuất CSV
          </button>
        </div>

        <div className="rounded-2xl border border-zinc-700 bg-zinc-900/70 p-5">
          <h3 className="text-lg text-white" style={{ fontWeight: 700 }}>Tổng kết</h3>
          <p className="mt-1 text-sm text-zinc-400">
            {studyMode === 'missed' ? 'Bạn đã hoàn thành vòng ôn câu sai.' : 'Bạn đã hoàn thành toàn bộ bộ flashcard.'}
          </p>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-4 py-3">
              <p className="text-xs text-emerald-300">Đã thuộc</p>
              <p className="text-2xl text-emerald-200" style={{ fontWeight: 700 }}>{knownCount}</p>
            </div>
            <div className="rounded-xl border border-red-500/35 bg-red-500/10 px-4 py-3">
              <p className="text-xs text-red-300">Chưa thuộc</p>
              <p className="text-2xl text-red-200" style={{ fontWeight: 700 }}>{unknownCount}</p>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              onClick={relearnAllCards}
              className="inline-flex items-center gap-2 rounded-xl bg-cyan-600 px-4 py-2.5 text-sm text-white hover:bg-cyan-500"
              style={{ fontWeight: 600 }}
            >
              <RotateCcw size={14} />Học lại toàn bộ
            </button>
            <button
              onClick={relearnWrongCards}
              disabled={missedCount === 0}
              className="inline-flex items-center gap-2 rounded-xl border border-red-500/35 bg-red-500/10 px-4 py-2.5 text-sm text-red-300 hover:bg-red-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ fontWeight: 600 }}
            >
              <X size={14} />Học lại câu sai
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-6 py-4">
      <div className="w-full flex justify-end">
        <button
          onClick={handleExportCsv}
          disabled={cardsState.length === 0}
          className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ fontWeight: 600 }}
        >
          <Download size={13} />Xuất CSV
        </button>
      </div>

      <div className="w-full space-y-2">
        <div className="flex justify-between text-xs text-zinc-500">
          <span>Thẻ {Math.min(currentIndex + 1, deckCards.length)} / {deckCards.length}</span>
          <div className="flex gap-3">
            <span className="text-emerald-400">{knownCount} thuộc</span>
            <span className="text-red-400">{unknownCount} chưa thuộc</span>
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
          <div
            className="w-full min-h-48 bg-zinc-900 border border-zinc-700 rounded-2xl p-8 flex flex-col items-center justify-center text-center"
            style={{ backfaceVisibility: 'hidden' }}
          >
            <div className="text-xs text-violet-400 mb-4 uppercase tracking-wider" style={{ fontWeight: 600 }}>{titleFront}</div>
            <p className="text-white text-lg" style={{ fontWeight: 600 }}>{current?.front_text}</p>
            <div className="mt-6 flex items-center gap-2 text-xs text-zinc-600">
              <RotateCcw size={12} />
              <span>Nhấn vào thẻ để xem đáp án</span>
            </div>
          </div>

          <div
            className="absolute inset-0 w-full min-h-48 bg-zinc-800 border border-violet-500/40 rounded-2xl p-8 flex flex-col items-center justify-center text-center"
            style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
          >
            <div className="text-xs text-cyan-400 mb-4 uppercase tracking-wider" style={{ fontWeight: 600 }}>{titleBack}</div>
            <p className="text-zinc-200 text-base leading-relaxed">{current?.back_text}</p>
          </div>
        </motion.div>
      </div>

      <div className={`flex flex-wrap gap-3 transition-opacity duration-300 ${isFlipped ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
        <button
          onClick={() => {
            void handleExplainCurrent();
          }}
          disabled={isExplaining || isUpdatingStatus}
          className="flex items-center gap-2 px-5 py-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 hover:bg-amber-500/20 disabled:opacity-60 disabled:cursor-not-allowed transition-all text-sm"
          style={{ fontWeight: 600 }}
        >
          {isExplaining ? <Loader2 size={15} className="animate-spin" /> : <Lightbulb size={15} />}Giải thích
        </button>
        <button
          onClick={() => {
            void handleRateCard('missed_it');
          }}
          disabled={isUpdatingStatus}
          className="flex items-center gap-2 px-8 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 disabled:opacity-60 disabled:cursor-not-allowed transition-all text-sm"
          style={{ fontWeight: 600 }}
        >
          <X size={16} />❌ Chưa thuộc
        </button>
        <button
          onClick={() => {
            void handleRateCard('got_it');
          }}
          disabled={isUpdatingStatus}
          className="flex items-center gap-2 px-8 py-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-60 disabled:cursor-not-allowed transition-all text-sm"
          style={{ fontWeight: 600 }}
        >
          <Check size={16} />✅ Đã thuộc
        </button>
      </div>

      {(isFlipped && (currentExplanation || explainError)) && (
        <div className="w-full rounded-xl border border-zinc-700 bg-zinc-900/70 px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-amber-300" style={{ fontWeight: 700 }}>Giải thích sâu</p>
          {currentExplanation && (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              className="prose prose-sm mt-2 max-w-none text-zinc-200 dark:prose-invert prose-headings:mb-2 prose-headings:mt-3 prose-h3:text-sm prose-h3:font-semibold prose-strong:text-zinc-100 prose-ul:my-2 prose-ul:pl-5 prose-li:my-1 break-words"
            >
              {currentExplanation}
            </ReactMarkdown>
          )}
          {!currentExplanation && explainError && (
            <p className="mt-2 text-sm text-red-300">{explainError}</p>
          )}
        </div>
      )}

      <div className="flex items-center gap-4 text-zinc-600 text-xs">
        <button
          onClick={() => {
            if (currentIndex > 0) {
              setCurrentIndex(i => i - 1);
              setIsFlipped(false);
            }
          }}
          disabled={currentIndex === 0}
          className="flex items-center gap-1 hover:text-zinc-400 disabled:opacity-30 transition-colors"
        >
          <ChevronLeft size={14} />Trước
        </button>
        <div className="flex gap-1">
          {deckCards.map((card, index) => (
            <div
              key={card.id}
              className={`w-1.5 h-1.5 rounded-full transition-colors ${
                index === currentIndex ? 'bg-violet-400' :
                card.status === 'got_it' ? 'bg-emerald-500' :
                card.status === 'missed_it' ? 'bg-red-500' :
                'bg-zinc-700'
              }`}
            />
          ))}
        </div>
        <button
          onClick={() => {
            if (currentIndex < deckCards.length - 1) {
              setCurrentIndex(i => i + 1);
              setIsFlipped(false);
            }
          }}
          disabled={currentIndex >= deckCards.length - 1}
          className="flex items-center gap-1 hover:text-zinc-400 disabled:opacity-30 transition-colors"
        >
          Sau<ChevronRight size={14} />
        </button>
      </div>

      <button
        onClick={restart}
        className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800"
        style={{ fontWeight: 600 }}
      >
        <RotateCcw size={13} />Về thẻ đầu
      </button>

      {error && (
        <div className="w-full rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}
    </div>
  );
}
