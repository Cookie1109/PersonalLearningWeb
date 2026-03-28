import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Brain, CheckCircle2, XCircle, ChevronRight, RotateCcw, Trophy, CreditCard, ListChecks, Sparkles, Zap } from 'lucide-react';
import { useApp } from '../context/AppContext';
import FlashCardDeck from '../components/FlashCard';
import { Flashcard } from '../lib/types';
import { QuizResponseDTO, QuizSubmitResponseDTO } from '../../api/dto';
import { fetchQuizByLesson, submitQuiz } from '../../api/quiz';

type Mode = 'select' | 'quiz' | 'flashcard' | 'quiz-result';

interface QuizState {
  currentIndex: number;
  selectedAnswers: Record<string, string>;
}

interface QuizPageProps {
  quizData?: QuizResponseDTO | null;
  flashcardsData?: Flashcard[];
  onFetchQuizByLesson?: (lessonId: string) => Promise<QuizResponseDTO>;
  onSubmitQuiz?: (payload: { quiz_id: string; lesson_id: string; user_answers: Record<string, string> }) => Promise<QuizSubmitResponseDTO>;
}

export default function QuizPage({
  quizData,
  flashcardsData = [],
  onFetchQuizByLesson = fetchQuizByLesson,
  onSubmitQuiz = submitQuiz,
}: QuizPageProps) {
  const { roadmap, addExpAndStreak } = useApp();
  const [mode, setMode] = useState<Mode>('select');
  const [quizState, setQuizState] = useState<QuizState>({ currentIndex: 0, selectedAnswers: {} });
  const [loadedQuiz, setLoadedQuiz] = useState<QuizResponseDTO | null>(quizData ?? null);
  const [quizResult, setQuizResult] = useState<QuizSubmitResponseDTO | null>(null);
  const [isLoadingQuiz, setIsLoadingQuiz] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const questions = loadedQuiz?.questions ?? [];
  const currentQuestion = questions[quizState.currentIndex];

  const score = quizResult?.score ?? 0;
  const correctCount = useMemo(() => {
    if (quizResult?.results) return quizResult.results.filter(item => item.is_correct).length;
    if (questions.length === 0) return 0;
    return Math.round((score / 100) * questions.length);
  }, [questions.length, quizResult, score]);

  const targetLessonId = useMemo(() => {
    const allLessons = roadmap.flatMap(week => week.lessons);
    const firstIncomplete = allLessons.find(lesson => !lesson.completed);
    return firstIncomplete?.id ?? allLessons[0]?.id ?? null;
  }, [roadmap]);

  useEffect(() => {
    setLoadedQuiz(quizData ?? null);
  }, [quizData]);

  useEffect(() => {
    if (quizData || !targetLessonId) return;

    let mounted = true;
    setIsLoadingQuiz(true);
    setLoadError(null);

    onFetchQuizByLesson(targetLessonId)
      .then(data => {
        if (!mounted) return;
        setLoadedQuiz(data);
      })
      .catch(() => {
        if (!mounted) return;
        setLoadError('Cannot load quiz data from server.');
      })
      .finally(() => {
        if (mounted) setIsLoadingQuiz(false);
      });

    return () => {
      mounted = false;
    };
  }, [quizData, targetLessonId, onFetchQuizByLesson]);

  const handleSelectAnswer = (optionKey: string) => {
    if (!currentQuestion) return;
    setQuizState(prev => ({
      ...prev,
      selectedAnswers: {
        ...prev.selectedAnswers,
        [currentQuestion.question_id]: optionKey,
      },
    }));
  };

  const handleSubmitQuiz = async () => {
    if (!loadedQuiz || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const result = await onSubmitQuiz({
        quiz_id: loadedQuiz.quiz_id,
        lesson_id: loadedQuiz.lesson_id,
        user_answers: quizState.selectedAnswers,
      });

      setQuizResult(result);
      if (result.score > 0) addExpAndStreak(Math.round((result.score / 100) * 100));
      setMode('quiz-result');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleNextQuestion = () => {
    if (quizState.currentIndex >= questions.length - 1) {
      handleSubmitQuiz();
      return;
    }

    setQuizState(prev => ({
      ...prev,
      currentIndex: prev.currentIndex + 1,
    }));
  };

  const restartQuiz = () => {
    setQuizState({ currentIndex: 0, selectedAnswers: {} });
    setQuizResult(null);
    setMode('quiz');
  };

  const handleFlashcardComplete = (known: number, total: number) => {
    if (total <= 0) return;
    const exp = Math.round((known / total) * 60);
    addExpAndStreak(exp);
  };

  if (mode === 'select') {
    return (
      <div className="max-w-3xl mx-auto px-6 py-8">
        <motion.div initial={{ opacity: 0, y: -15 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-cyan-700 flex items-center justify-center">
              <Brain size={20} className="text-white" />
            </div>
            <div>
              <h1 className="text-2xl text-white" style={{ fontWeight: 700 }}>Quiz and Flashcard</h1>
              <p className="text-zinc-500 text-sm">Server-driven quiz contracts with secure payloads</p>
            </div>
          </div>
        </motion.div>

        <div className="grid grid-cols-3 gap-4 mb-8">
          {[
            { icon: Trophy, label: 'Questions', value: questions.length, color: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/20' },
            { icon: CreditCard, label: 'Flashcards', value: flashcardsData.length, color: 'text-cyan-400', bg: 'bg-cyan-500/10', border: 'border-cyan-500/20' },
            { icon: Zap, label: 'Max EXP', value: `${questions.length * 100}`, color: 'text-violet-400', bg: 'bg-violet-500/10', border: 'border-violet-500/20' },
          ].map(({ icon: Icon, label, value, color, bg, border }) => (
            <div key={label} className={`${bg} border ${border} rounded-2xl p-5 text-center`}>
              <Icon size={20} className={`${color} mx-auto mb-2`} />
              <p className="text-2xl text-white" style={{ fontWeight: 700 }}>{value}</p>
              <p className="text-xs text-zinc-500">{label}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setMode('quiz')}
            disabled={!loadedQuiz || questions.length === 0}
            className="bg-zinc-900 border border-zinc-800 hover:border-cyan-500/40 disabled:opacity-50 disabled:cursor-not-allowed rounded-2xl p-6 text-left transition-all group"
          >
            <div className="w-12 h-12 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center mb-4 group-hover:bg-cyan-500/20 transition-colors">
              <ListChecks size={22} className="text-cyan-400" />
            </div>
            <h3 className="text-white" style={{ fontWeight: 700 }}>Quiz</h3>
            <p className="text-zinc-500 text-sm mt-1">{questions.length} questions loaded from backend DTO contracts</p>
          </motion.button>

          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setMode('flashcard')}
            className="bg-zinc-900 border border-zinc-800 hover:border-violet-500/40 rounded-2xl p-6 text-left transition-all group"
          >
            <div className="w-12 h-12 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center mb-4 group-hover:bg-violet-500/20 transition-colors">
              <CreditCard size={22} className="text-violet-400" />
            </div>
            <h3 className="text-white" style={{ fontWeight: 700 }}>Flashcard</h3>
            <p className="text-zinc-500 text-sm mt-1">{flashcardsData.length} cards provided by typed props</p>
          </motion.button>
        </div>

        <div className="mt-6 bg-violet-500/10 border border-violet-500/20 rounded-xl p-4 flex items-start gap-3">
          <Sparkles size={16} className="text-violet-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-zinc-300" style={{ fontWeight: 500 }}>Security mode enabled</p>
            <p className="text-xs text-zinc-500 mt-0.5">Quiz payload does not expose correct answers in GET response.</p>
          </div>
        </div>

        {isLoadingQuiz && <p className="text-sm text-zinc-500 mt-4">Loading quiz from backend...</p>}
        {loadError && <p className="text-sm text-red-400 mt-4">{loadError}</p>}
      </div>
    );
  }

  if (mode === 'flashcard') {
    return (
      <div className="max-w-2xl mx-auto px-6 py-8">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => setMode('select')} className="p-2 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors">
            <ChevronRight size={18} className="rotate-180" />
          </button>
          <h2 className="text-white" style={{ fontWeight: 700 }}>Flashcard practice</h2>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
          <FlashCardDeck cards={flashcardsData} onComplete={handleFlashcardComplete} />
        </div>
      </div>
    );
  }

  if (mode === 'quiz-result') {
    const grade = score >= 80
      ? { label: 'Excellent', color: 'text-yellow-400', bg: 'bg-yellow-500/10' }
      : score >= 60
        ? { label: 'Good', color: 'text-cyan-400', bg: 'bg-cyan-500/10' }
        : { label: 'Needs review', color: 'text-violet-400', bg: 'bg-violet-500/10' };

    return (
      <div className="max-w-2xl mx-auto px-6 py-8">
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className={`${grade.bg} border border-zinc-800 rounded-2xl p-8 text-center`}>
          <h2 className="text-3xl text-white mb-2" style={{ fontWeight: 800 }}>{grade.label}</h2>
          <p className="text-zinc-400">Server score</p>
          <div className={`text-6xl my-6 ${grade.color}`} style={{ fontWeight: 800 }}>{score}%</div>
          <p className="text-zinc-300 text-sm">{correctCount}/{questions.length} correct answers</p>

          <div className="mt-6 space-y-2 text-left">
            {(quizResult?.results ?? []).map((answer, i) => (
              <div key={answer.question_id} className={`flex items-center gap-3 p-3 rounded-xl ${answer.is_correct ? 'bg-emerald-500/10 border border-emerald-500/20' : 'bg-red-500/10 border border-red-500/20'}`}>
                {answer.is_correct ? <CheckCircle2 size={16} className="text-emerald-400 flex-shrink-0" /> : <XCircle size={16} className="text-red-400 flex-shrink-0" />}
                <p className="text-sm text-zinc-300 truncate">Question {i + 1}: {questions[i]?.text.slice(0, 60)}...</p>
              </div>
            ))}
          </div>

          <div className="flex gap-3 mt-8">
            <button onClick={restartQuiz} className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors text-sm" style={{ fontWeight: 600 }}>
              <RotateCcw size={15} />Retry
            </button>
            <button onClick={() => setMode('select')} className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-violet-600 text-white hover:bg-violet-500 transition-colors text-sm" style={{ fontWeight: 600 }}>
              <Brain size={15} />Back
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <button onClick={() => setMode('select')} className="flex items-center gap-2 text-sm text-zinc-500 hover:text-zinc-300 transition-colors">
          <ChevronRight size={16} className="rotate-180" />Exit
        </button>
        <div className="flex items-center gap-3">
          <span className="text-xs text-zinc-500">Question {quizState.currentIndex + 1}/{questions.length}</span>
          <div className="flex items-center gap-1 text-xs text-emerald-400" style={{ fontWeight: 600 }}>
            <CheckCircle2 size={12} />{Object.keys(quizState.selectedAnswers).length} answered
          </div>
        </div>
      </div>

      <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden mb-8">
        <motion.div
          animate={{ width: `${questions.length > 0 ? (quizState.currentIndex / questions.length) * 100 : 0}%` }}
          className="h-full bg-cyan-500 rounded-full"
        />
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={quizState.currentIndex}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          className="space-y-6"
        >
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <span className="w-7 h-7 rounded-lg bg-cyan-500/20 border border-cyan-500/30 text-cyan-400 text-xs flex items-center justify-center flex-shrink-0" style={{ fontWeight: 700 }}>
                {quizState.currentIndex + 1}
              </span>
              <span className="text-xs text-zinc-500">Quiz</span>
            </div>
            <h3 className="text-lg text-white leading-relaxed" style={{ fontWeight: 600 }}>{currentQuestion?.text}</h3>
          </div>

          <div className="space-y-3">
            {currentQuestion?.options.map((option, i) => {
              const selectedKey = quizState.selectedAnswers[currentQuestion.question_id];
              const isSelected = selectedKey === option.option_key;

              let className = 'w-full text-left px-5 py-4 rounded-xl border text-sm transition-all ';
              if (!selectedKey) {
                className += 'bg-zinc-900 border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:bg-zinc-800 cursor-pointer';
              } else if (isSelected) {
                className += 'bg-cyan-500/10 border-cyan-500/40 text-cyan-300';
              } else {
                className += 'bg-zinc-900 border-zinc-800 text-zinc-600 cursor-default';
              }

              return (
                <motion.button
                  key={option.option_key}
                  onClick={() => handleSelectAnswer(option.option_key)}
                  className={className}
                  whileHover={!selectedKey ? { scale: 1.01 } : {}}
                  whileTap={!selectedKey ? { scale: 0.99 } : {}}
                >
                  <div className="flex items-center gap-3">
                    <span className={`w-6 h-6 rounded-full border text-xs flex items-center justify-center flex-shrink-0 ${
                      !selectedKey ? 'border-zinc-600 text-zinc-500' :
                      isSelected ? 'border-cyan-400 text-cyan-400' :
                      'border-zinc-700 text-zinc-700'
                    }`} style={{ fontWeight: 600 }}>
                      {option.option_key || String.fromCharCode(65 + i)}
                    </span>
                    <span>{option.text}</span>
                    {selectedKey && isSelected && <CheckCircle2 size={16} className="ml-auto text-cyan-400 flex-shrink-0" />}
                  </div>
                </motion.button>
              );
            })}
          </div>

          <div className="overflow-hidden rounded-xl border p-4 bg-zinc-900 border-zinc-700">
            <div className="flex items-start gap-3">
              <Sparkles size={15} className="text-violet-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs text-violet-400 mb-1" style={{ fontWeight: 600 }}>
                  Evaluation is server-side only
                </p>
                <p className="text-sm text-zinc-300 leading-relaxed">
                  This payload never contains correct answers before submit.
                </p>
              </div>
            </div>

            <button
              onClick={handleNextQuestion}
              disabled={!currentQuestion || !quizState.selectedAnswers[currentQuestion.question_id] || isSubmitting}
              className="mt-4 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm transition-colors"
              style={{ fontWeight: 600 }}
            >
              {quizState.currentIndex < questions.length - 1 ? (
                <><ChevronRight size={16} />Next question</>
              ) : (
                <><Trophy size={16} />{isSubmitting ? 'Submitting...' : 'Submit quiz'}</>
              )}
            </button>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
