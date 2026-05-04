import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';
import {
  CheckCircle2, BookOpen,
  Loader2, Zap,
  MessageSquare, CreditCard, ListChecks, Lightbulb, RefreshCw
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import {
  completeFlashcardProgress,
  completeLessonProgress,
  generateLesson,
  getLessonDetail,
  LessonDetail,
} from '../../api/learning';
import { trackGamification } from '../../api/gamification';
import AITutorChat from '../components/AITutorChat';
import FlashCardDeck from '../components/FlashCard';
import { Flashcard } from '../lib/types';
import { GamificationTrackResponseDTO, QuizResponseDTO, QuizSubmitResponseDTO } from '../../api/dto';
import { fetchQuizByDocument, generateQuizByDocument, submitQuizByDocument } from '../../api/quiz';
import useReadingTracker from '../hooks/useReadingTracker';

type LearningTab = 'theory' | 'quiz' | 'flashcard' | 'qa';

interface QuizState {
  currentIndex: number;
  selectedAnswers: Record<string, string>;
}

interface QuizResultDisplayProps {
  quizResult: QuizSubmitResponseDTO;
  quizQuestions: QuizResponseDTO['questions'];
  onRetry: () => void;
  onBackToTheory: () => void;
  onRegenerate: () => void;
  isRegenerating: boolean;
  isRegenerateDisabled: boolean;
  regenerateTooltip: string;
  regenerationCount: number;
}

type MarkdownCodeComponentProps = React.ComponentPropsWithoutRef<'code'> & {
  inline?: boolean;
};

const QUIZ_TYPE_LABELS: Record<string, string> = {
  theory: 'Lý thuyết',
  fill_code: 'Điền code',
  find_bug: 'Tìm lỗi',
  general_choice: 'Trắc nghiệm',
  fill_blank: 'Điền khuyết',
};

const QUIZ_DIFFICULTY_STYLES: Record<string, string> = {
  Easy: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300',
  Medium: 'border-amber-500/40 bg-amber-500/15 text-amber-300',
  Hard: 'border-red-500/40 bg-red-500/15 text-red-300',
};

function getQuizTypeLabel(type: string | null | undefined): string {
  if (!type) return 'Khác';
  return QUIZ_TYPE_LABELS[type] ?? type;
}

function getQuizDifficultyStyle(difficulty: string | null | undefined): string {
  if (!difficulty) {
    return 'border-zinc-600 bg-zinc-800/70 text-zinc-300';
  }
  return QUIZ_DIFFICULTY_STYLES[difficulty] ?? 'border-zinc-600 bg-zinc-800/70 text-zinc-300';
}

function parseRetryAfterSeconds(rawValue: unknown): number {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.max(0, Math.floor(parsed));
}

function cleanQuizOptionText(rawOptionText: string): string {
  return String(rawOptionText)
    .replace(/^[A-D][\.\:\)]\s*/i, '')
    .trim();
}

function normalizeSelectedAnswersMap(rawValue: unknown): Record<string, string> {
  if (!rawValue || typeof rawValue !== 'object') {
    return {};
  }

  return Object.entries(rawValue as Record<string, unknown>).reduce<Record<string, string>>((acc, [questionId, selected]) => {
    if (typeof selected !== 'string') {
      return acc;
    }
    const normalizedQuestionId = String(questionId).trim();
    const normalizedSelected = selected.trim();
    if (!normalizedQuestionId || !normalizedSelected) {
      return acc;
    }
    acc[normalizedQuestionId] = normalizedSelected;
    return acc;
  }, {});
}

function isLearningTab(value: string | null): value is LearningTab {
  return value === 'theory' || value === 'quiz' || value === 'flashcard' || value === 'qa';
}

function _stripMarkdownArtifacts(raw: string): string {
  return raw
    .replace(/^#{1,6}\s+/, '')
    .replace(/^[-*+]\s+/, '')
    .replace(/^\d+\.\s+/, '')
    .replace(/^>\s?/, '')
    .replace(/`/g, '')
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

type FlashcardSeedKind = 'concept' | 'process' | 'parameter' | 'cause-effect' | 'fact' | 'cloze' | 'context';

interface KnowledgeEntry {
  section: string;
  text: string;
  isList: boolean;
  order: number | null;
}

interface FlashcardSeed {
  front: string;
  back: string;
  kind: FlashcardSeedKind;
  section: string;
  sourceText: string;
}

function _foldForMatch(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

function _normalizeKnowledgeText(raw: string): string {
  return _stripMarkdownArtifacts(raw)
    .replace(/[\t ]+/g, ' ')
    .replace(/\s+([,.;!?])/g, '$1')
    .trim();
}

function _smartTrim(raw: string, maxLength: number): string {
  const normalized = _normalizeKnowledgeText(raw);
  if (normalized.length <= maxLength) {
    return normalized;
  }

  const searchStart = Math.floor(maxLength * 0.55);
  let punctuationCut = -1;
  for (let i = searchStart; i <= maxLength && i < normalized.length; i += 1) {
    if ('.;!?'.includes(normalized[i])) {
      punctuationCut = i + 1;
    }
  }

  if (punctuationCut > 0) {
    return normalized.slice(0, punctuationCut).trim();
  }

  const spaceCut = normalized.lastIndexOf(' ', maxLength);
  if (spaceCut > Math.floor(maxLength * 0.6)) {
    return `${normalized.slice(0, spaceCut).trim()}...`;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function _hasTechnicalSignal(foldedText: string): boolean {
  return /\b(api|ide|editor|compiler|gcc|clang|msvc|database|index|sql|react|hook|state|component|function|module|debug|build|deploy|env|docker|cache|thread|algorithm|python|javascript|typescript|c\+\+|java|linux|windows|macos|http|https|token|port|pandas|dataframe)\b/i.test(foldedText);
}

function _isNoiseSentence(raw: string): boolean {
  const text = _normalizeKnowledgeText(raw);
  if (!text) {
    return true;
  }

  const folded = _foldForMatch(text);
  const lowSignalStarters = [
    'trong bài học này',
    'chúng ta sẽ',
    'mục tiêu là',
    'bạn có thể',
    'hãy nhớ rằng',
    'dưới đây là',
    'mời bạn',
  ];

  if (lowSignalStarters.some(prefix => folded.startsWith(_foldForMatch(prefix))) && !_hasTechnicalSignal(folded)) {
    return true;
  }

  if (text.length < 12) {
    return true;
  }

  return false;
}

function _splitAtomicIdeas(raw: string): string[] {
  const normalized = _normalizeKnowledgeText(raw);
  if (!normalized) {
    return [];
  }

  const sentenceParts = normalized
    .split(/(?<=[.!?;])\s+/)
    .map(part => part.trim())
    .filter(Boolean);
  const sourceParts = sentenceParts.length > 0 ? sentenceParts : [normalized];
  const atomicParts: string[] = [];

  for (const part of sourceParts) {
    const secondaryParts = part
      .split(/,\s+(?:sau do|tiep theo|roi|nhung|tuy nhien|vi vay)\s+/i)
      .map(item => item.trim())
      .filter(Boolean);

    if (secondaryParts.length > 1) {
      for (const item of secondaryParts) {
        if (item.length >= 12 && !_isNoiseSentence(item)) {
          atomicParts.push(item);
        }
      }
    } else if (part.length >= 12 && !_isNoiseSentence(part)) {
      atomicParts.push(part);
    }
  }

  return atomicParts;
}

function _extractKnowledgeEntries(markdown: string): KnowledgeEntry[] {
  const lines = markdown.split('\n');
  const entries: KnowledgeEntry[] = [];
  let currentSection = 'Tong quan';
  let inCodeBlock = false;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      continue;
    }

    if (trimmed.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) {
      continue;
    }

    if (/^#{2,4}\s+/.test(trimmed)) {
      currentSection = _normalizeKnowledgeText(trimmed) || currentSection;
      continue;
    }

    if (/^>\s*/.test(trimmed) || /^!\[.*\]\(.*\)$/.test(trimmed)) {
      continue;
    }

    if (/^\|[-:\s|]+\|$/.test(trimmed)) {
      continue;
    }

    if (/^\|.*\|$/.test(trimmed)) {
      const cells = trimmed
        .split('|')
        .map(cell => _normalizeKnowledgeText(cell))
        .filter(Boolean);
      if (cells.length >= 2) {
        const merged = `${cells[0]}: ${cells.slice(1).join(' - ')}`;
        if (!_isNoiseSentence(merged)) {
          entries.push({ section: currentSection, text: merged, isList: false, order: null });
        }
      }
      continue;
    }

    const orderedMatch = trimmed.match(/^(\d+)\.\s+(.+)$/);
    const bulletMatch = trimmed.match(/^[-*+]\s+(.+)$/);
    const payload = orderedMatch?.[2] ?? bulletMatch?.[1] ?? trimmed;
    const atomics = _splitAtomicIdeas(payload);

    for (const atomic of atomics) {
      const normalizedAtomic = _normalizeKnowledgeText(atomic);
      if (_isNoiseSentence(normalizedAtomic)) {
        continue;
      }
      entries.push({
        section: currentSection,
        text: normalizedAtomic,
        isList: Boolean(orderedMatch || bulletMatch),
        order: orderedMatch ? Number(orderedMatch[1]) : null,
      });
    }
  }

  const seen = new Set<string>();
  return entries.filter(entry => {
    const key = `${_foldForMatch(entry.section)}|${_foldForMatch(entry.text)}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function _splitByFoldedToken(text: string, token: string): [string, string] | null {
  const folded = _foldForMatch(text);
  const index = folded.indexOf(token);
  if (index <= 0) {
    return null;
  }

  const left = _normalizeKnowledgeText(text.slice(0, index));
  const right = _normalizeKnowledgeText(text.slice(index + token.length));
  if (!left || !right) {
    return null;
  }

  return [left, right];
}

function _detectDefinition(text: string): { term: string; meaning: string } | null {
  const tokens = [' la ', ' duoc goi la ', ' duoc dung de ', ' bao gom '];
  for (const token of tokens) {
    const parts = _splitByFoldedToken(text, token);
    if (!parts) {
      continue;
    }
    const [term, meaning] = parts;
    if (term.length >= 2 && term.length <= 64 && meaning.length >= 10) {
      return { term, meaning };
    }
  }

  return null;
}

function _detectParameter(text: string): { key: string; value: string } | null {
  const pairMatch = text.match(/^([^:=]{2,48})\s*[:=]\s*(.{8,})$/);
  if (!pairMatch) {
    return null;
  }

  const key = _normalizeKnowledgeText(pairMatch[1]);
  const value = _normalizeKnowledgeText(pairMatch[2]);
  if (!key || !value) {
    return null;
  }

  const keyWords = key.split(/\s+/).filter(Boolean);
  if (keyWords.length > 8) {
    return null;
  }

  return { key, value };
}

function _detectCauseEffect(text: string): { cause: string; effect: string } | null {
  const folded = _foldForMatch(text);

  if (folded.startsWith('neu ')) {
    const parts = _splitByFoldedToken(text, ' thi ');
    if (parts) {
      const cause = parts[0].replace(/^(neu|Nếu|Neu)\s+/i, '').trim();
      const effect = parts[1].trim();
      if (cause.length >= 6 && effect.length >= 6) {
        return { cause, effect };
      }
    }
  }

  if (folded.startsWith('khi ')) {
    const withThen = _splitByFoldedToken(text, ' thi ') ?? _splitByFoldedToken(text, ' se ');
    if (withThen) {
      const cause = withThen[0].replace(/^(khi|Khi)\s+/i, '').trim();
      const effect = withThen[1].trim();
      if (cause.length >= 6 && effect.length >= 6) {
        return { cause, effect };
      }
    }
  }

  const causalTokens = [' dan den ', ' gay ', ' lam '];
  for (const token of causalTokens) {
    const parts = _splitByFoldedToken(text, token);
    if (!parts) {
      continue;
    }
    const [cause, effect] = parts;
    if (cause.length >= 6 && effect.length >= 6) {
      return { cause, effect };
    }
  }

  return null;
}

function _extractTopic(text: string, fallback: string): string {
  const normalized = _normalizeKnowledgeText(text).replace(/[.?!].*$/, '').trim();
  if (!normalized) {
    return fallback;
  }

  const compact = normalized.split(':')[0].trim();
  if (compact.length >= 4 && compact.length <= 64) {
    return compact;
  }

  const words = normalized.split(/\s+/).slice(0, 6).join(' ').trim();
  return words.length >= 4 ? words : fallback;
}

function _buildSeed(
  kind: FlashcardSeedKind,
  frontRaw: string,
  backRaw: string,
  section: string,
  sourceText: string,
): FlashcardSeed | null {
  const front = _smartTrim(frontRaw, 120);
  const back = _smartTrim(backRaw, 220);
  const minBackLength = kind === 'cloze' ? 2 : 10;
  if (!front || !back || front.length < 10 || back.length < minBackLength) {
    return null;
  }

  return {
    front,
    back,
    kind,
    section,
    sourceText,
  };
}

function _escapeRegExp(raw: string): string {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function _pickClozeToken(raw: string): string | null {
  const normalized = _normalizeKnowledgeText(raw);
  const technicalHint = normalized.match(/\b(api|ide|compiler|gcc|clang|msvc|database|index|sql|react|hook|state|debug|build|endpoint|request|response|token|cache|thread|docker|module|function|class|object)\b/i);
  if (technicalHint?.[0]) {
    return technicalHint[0];
  }

  const quoted = raw.match(/["“'`](.{2,30}?)["”'`]/);
  if (quoted?.[1]) {
    return quoted[1].trim();
  }

  const acronym = raw.match(/\b[A-Z][A-Z0-9+.#-]{1,}\b/);
  if (acronym?.[0]) {
    return acronym[0];
  }

  const callable = raw.match(/\b[a-zA-Z_][a-zA-Z0-9_]*\(\)/);
  if (callable?.[0]) {
    return callable[0];
  }

  const stopWords = new Set([
    'trong', 'nhung', 'duoc', 'dung', 'chinh', 'nguoi', 'thong', 'trinh',
    'hoac', 'voi', 'khi', 'thi', 'neu', 'cac', 'mot', 'bai', 'hoc',
  ]);
  const words = normalized.split(/\s+/).filter(Boolean);
  for (const word of words) {
    const cleaned = word.replace(/^[^a-zA-Z0-9+.#-]+|[^a-zA-Z0-9+.#-]+$/g, '');
    const folded = _foldForMatch(cleaned);
    if (cleaned.length >= 5 && !stopWords.has(folded)) {
      return cleaned;
    }
  }

  return null;
}

function _buildClozeSeed(seed: FlashcardSeed): FlashcardSeed | null {
  const token = _pickClozeToken(seed.back) ?? _pickClozeToken(seed.sourceText) ?? _pickClozeToken(seed.front);
  if (!token) {
    return null;
  }

  const tokenRegex = new RegExp(_escapeRegExp(token), 'i');
  const baseText = tokenRegex.test(seed.back) ? seed.back : seed.sourceText;
  const masked = baseText.replace(tokenRegex, '____');
  if (masked === baseText || masked.length < 12) {
    return null;
  }

  return _buildSeed('cloze', `Điền vào chỗ trống: ${masked}`, token, seed.section, seed.sourceText);
}

function _buildContextSeed(seeds: FlashcardSeed[], entries: KnowledgeEntry[]): FlashcardSeed | null {
  const corpus = entries.map(entry => `${entry.section} ${entry.text}`).join(' ');
  const foldedCorpus = _foldForMatch(corpus);

  const ruleMatches: Array<{ pattern: RegExp; front: string; back: string }> = [
    {
      pattern: /\b(compiler|gcc|clang|msvc|bien dich|build)\b/,
      front: 'Tình huống IT: Khi nào bạn cần chạy compiler trong project C++?',
      back: 'Khi cần biên mã nguồn thành mã máy và bắt lỗi cú pháp/type trước khi chạy chương trình.',
    },
    {
      pattern: /\b(ide|editor|vs code|vscode|debug)\b/,
      front: 'Tình huống IT: IDE giúp gì khi bạn debug một lỗi khó?',
      back: 'IDE cho phép đặt breakpoint, theo dõi biến, và trace từng bước để khoanh vùng nguyên nhân nhanh hơn.',
    },
    {
      pattern: /\b(index|database|sql)\b/,
      front: 'Tình huống IT: Khi nào việc đánh index có thể làm giảm hiệu năng?',
      back: 'Khi bảng ghi/cập nhật liên tục hoặc cột có độ chọn lọc thấp, chi phí cập nhật index lớn hơn lợi ích truy vấn.',
    },
    {
      pattern: /\b(api|http|request|response|endpoint)\b/,
      front: 'Tình huống IT: Khi tích hợp API, cần kiểm tra gì để tránh lỗi runtime?',
      back: 'Kiểm tra hợp đồng input/output, mã lỗi HTTP, timeout và retry để hệ thống ổn định trong thực tế.',
    },
  ];

  for (const rule of ruleMatches) {
    if (rule.pattern.test(foldedCorpus)) {
      return _buildSeed('context', rule.front, rule.back, 'Tình huống IT', rule.back);
    }
  }

  const fallbackSeed = seeds.find(seed => seed.kind === 'concept' || seed.kind === 'process') ?? seeds[0];
  if (!fallbackSeed) {
    return null;
  }

  const topic = _extractTopic(fallbackSeed.section, 'kiến thức này');
  return _buildSeed(
    'context',
    `Tình huống IT: Trong dự án thật, bạn áp dụng "${topic}" khi nào?`,
    fallbackSeed.back,
    fallbackSeed.section,
    fallbackSeed.sourceText,
  );
}

function _seedKey(seed: FlashcardSeed): string {
  return `${_foldForMatch(seed.front)}|${_foldForMatch(seed.back)}`;
}

export function buildFlashcardsFromMarkdown(markdown: string | null, maxCards: number = 8): Flashcard[] {
  if (!markdown || !markdown.trim()) {
    return [];
  }

  const entries = _extractKnowledgeEntries(markdown);
  if (entries.length === 0) {
    return [];
  }

  const conceptSeeds: FlashcardSeed[] = [];
  const processSeeds: FlashcardSeed[] = [];
  const parameterSeeds: FlashcardSeed[] = [];
  const causeEffectSeeds: FlashcardSeed[] = [];
  const factSeeds: FlashcardSeed[] = [];

  for (const entry of entries) {
    const parameter = _detectParameter(entry.text);
    if (parameter) {
      const seed = _buildSeed(
        'parameter',
        `Thong so "${parameter.key}" trong "${entry.section}" dung de lam gi?`,
        parameter.value,
        entry.section,
        entry.text,
      );
      if (seed) {
        parameterSeeds.push(seed);
      }
      continue;
    }

    const definition = _detectDefinition(entry.text);
    if (definition) {
      const seed = _buildSeed(
        'concept',
        `Khai niem "${definition.term}" la gi?`,
        definition.meaning,
        entry.section,
        entry.text,
      );
      if (seed) {
        conceptSeeds.push(seed);
      }
      continue;
    }

    const causeEffect = _detectCauseEffect(entry.text);
    if (causeEffect) {
      const seed = _buildSeed(
        'cause-effect',
        `Neu ${causeEffect.cause}, dieu gi xay ra?`,
        causeEffect.effect,
        entry.section,
        entry.text,
      );
      if (seed) {
        causeEffectSeeds.push(seed);
      }
      continue;
    }

    if (entry.isList) {
      const stepLabel = entry.order ? `bước ${entry.order}` : 'một bước quan trọng';
      const seed = _buildSeed(
        'process',
        `Trong "${entry.section}", ${stepLabel} cần làm gì?`,
        entry.text,
        entry.section,
        entry.text,
      );
      if (seed) {
        processSeeds.push(seed);
      }
      continue;
    }

    const topic = _extractTopic(entry.section === 'Tổng quan' ? entry.text : entry.section, 'nội dung này');
    const seed = _buildSeed(
      'fact',
      `Ý chính cần nhớ về "${topic}" là gì?`,
      entry.text,
      entry.section,
      entry.text,
    );
    if (seed) {
      factSeeds.push(seed);
    }
  }

  const selected: FlashcardSeed[] = [];
  const selectedKeys = new Set<string>();
  const maxBaseCards = Math.max(1, maxCards - 2);

  const tryAddSeed = (seed: FlashcardSeed): boolean => {
    const key = _seedKey(seed);
    if (selectedKeys.has(key)) {
      return false;
    }
    selected.push(seed);
    selectedKeys.add(key);
    return true;
  };

  const addFromBucket = (bucket: FlashcardSeed[], limit: number) => {
    let count = 0;
    for (const seed of bucket) {
      if (selected.length >= maxBaseCards || count >= limit) {
        break;
      }
      if (tryAddSeed(seed)) {
        count += 1;
      }
    }
  };

  addFromBucket(conceptSeeds, 3);
  addFromBucket(processSeeds, 2);
  addFromBucket(parameterSeeds, 2);
  addFromBucket(causeEffectSeeds, 2);
  addFromBucket(factSeeds, maxBaseCards);

  if (selected.length < maxBaseCards) {
    const overflowPool = [...conceptSeeds, ...processSeeds, ...parameterSeeds, ...causeEffectSeeds, ...factSeeds];
    for (const seed of overflowPool) {
      if (selected.length >= maxBaseCards) {
        break;
      }
      tryAddSeed(seed);
    }
  }

  if (selected.length < maxCards) {
    const clozeCandidates = [
      ...selected,
      ...conceptSeeds,
      ...processSeeds,
      ...parameterSeeds,
      ...causeEffectSeeds,
      ...factSeeds,
    ];

    for (const seed of clozeCandidates) {
      if (seed.kind === 'concept' || seed.kind === 'process' || seed.kind === 'parameter') {
        const clozeSeed = _buildClozeSeed(seed);
        if (clozeSeed && tryAddSeed(clozeSeed)) {
          break;
        }
      }
    }
  }

  if (selected.length < maxCards) {
    const contextSeed = _buildContextSeed(selected, entries);
    if (contextSeed) {
      tryAddSeed(contextSeed);
    }
  }

  if (selected.length === 0) {
    return [];
  }

  return selected.slice(0, maxCards).map((seed, index) => ({
    id: `focus-card-${index}`,
    front: seed.front,
    back: seed.back,
  }));
}

export function QuizResultDisplay({
  quizResult,
  quizQuestions,
  onRetry,
  onBackToTheory,
  onRegenerate,
  isRegenerating,
  isRegenerateDisabled,
  regenerateTooltip,
  regenerationCount,
}: QuizResultDisplayProps) {
  const correctCount = quizResult.results.filter(item => item.is_correct).length;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-5 text-slate-900 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-white">
      <div className="text-center">
        <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-zinc-500">Kết quả quiz</p>
        <p
          className={`text-5xl mt-2 ${quizResult.is_passed
            ? 'text-emerald-600 dark:text-emerald-400'
            : 'text-amber-600 dark:text-amber-400'}`}
          style={{ fontWeight: 800 }}
        >
          {quizResult.score}%
        </p>
        <p className="text-slate-600 dark:text-zinc-300 text-sm mt-2">{correctCount}/{quizQuestions.length} câu đúng</p>
        {quizResult.is_passed ? (
          <p className="text-emerald-600 dark:text-emerald-300 text-sm mt-2">Bạn đã đạt quiz. Icon Quiz sẽ sáng ngay lập tức.</p>
        ) : (
          <p className="text-amber-600 dark:text-amber-300 text-sm mt-2">Chưa đạt ngưỡng. Hãy ôn lại lý thuyết và thử lại.</p>
        )}
      </div>

      {quizResult.reward_granted && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
          Chúc mừng! Bạn nhận {quizResult.exp_gained} EXP khi vượt quiz lần đầu.
        </div>
      )}

      <div className="space-y-3">
        {quizResult.results.map((answer, index) => {
          const question = quizQuestions[index];
          const optionTextByKey = new Map(
            (question?.options ?? []).map(option => [option.option_key, cleanQuizOptionText(option.text)])
          );
          const selectedOptionText = answer.selected_option
            ? (optionTextByKey.get(answer.selected_option) ?? answer.selected_option)
            : 'Không chọn đáp án';
          const correctOptionText = answer.correct_answer
            ? (optionTextByKey.get(answer.correct_answer) ?? answer.correct_answer)
            : 'Không xác định';

          return (
            <div key={answer.question_id} className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-zinc-700 dark:bg-zinc-950/60">
              <p className="text-sm text-slate-800 dark:text-zinc-100" style={{ fontWeight: 700 }}>
                Câu {index + 1}
              </p>
              <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900/70">
                <QuizQuestionMarkdown content={question?.text ?? 'Nội dung câu hỏi'} />
              </div>

              {answer.is_correct ? (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-100">
                  Bạn đã trả lời đúng: <span style={{ fontWeight: 700 }}>{correctOptionText}</span>
                </div>
              ) : (
                <>
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:border-red-500/40 dark:bg-red-500/15 dark:text-red-100">
                    Bạn đã chọn: <span style={{ fontWeight: 700 }}>{selectedOptionText}</span>
                  </div>
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-100">
                    Đáp án đúng: <span style={{ fontWeight: 700 }}>{correctOptionText}</span>
                  </div>
                </>
              )}

              {answer.explanation && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-amber-700 dark:border-amber-400/35 dark:bg-amber-400/10 dark:text-amber-100">
                  <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-amber-700 dark:text-amber-300" style={{ fontWeight: 700 }}>
                    <Lightbulb size={13} />Giải thích
                  </div>
                  <p className="mt-1.5 text-sm leading-relaxed text-amber-700 dark:text-amber-100/95">{answer.explanation}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="space-y-2">
        <span className="block" title={regenerateTooltip}>
          <button
            onClick={onRegenerate}
            disabled={isRegenerating || isRegenerateDisabled}
            className="w-full rounded-xl border border-cyan-200 bg-cyan-50 hover:bg-cyan-100 disabled:opacity-60 disabled:cursor-not-allowed text-cyan-700 px-4 py-2.5 text-sm inline-flex items-center justify-center gap-2 dark:border-cyan-500/40 dark:bg-cyan-500/10 dark:hover:bg-cyan-500/20 dark:text-cyan-100"
            style={{ fontWeight: 600 }}
          >
            <RefreshCw size={14} className={isRegenerating ? 'animate-spin' : ''} />
            {isRegenerating ? 'Đang tạo lại quiz...' : 'Tạo lại Quiz mới'}
          </button>
        </span>
      </div>

      <div className="flex gap-3">
        <button
          onClick={onRetry}
          className="flex-1 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2.5 text-sm dark:bg-zinc-800 dark:hover:bg-zinc-700 dark:text-zinc-100"
          style={{ fontWeight: 600 }}
        >
          Làm lại quiz
        </button>
        <button
          onClick={onBackToTheory}
          className="flex-1 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white px-4 py-2.5 text-sm"
          style={{ fontWeight: 600 }}
        >
          Quay lại lý thuyết
        </button>
      </div>
    </div>
  );
}

const MarkdownContent = React.memo(function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="max-w-none select-text text-zinc-300">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          h2: ({ children }) => <h2 className="text-xl text-white mt-6 mb-3 select-text" style={{ fontWeight: 700 }}>{children}</h2>,
          h3: ({ children }) => <h3 className="text-base text-zinc-200 mt-4 mb-2 select-text" style={{ fontWeight: 600 }}>{children}</h3>,
          p: ({ children }) => <p className="text-sm leading-relaxed mb-4 select-text">{children}</p>,
          ul: ({ children }) => <ul className="list-disc pl-5 space-y-1 text-sm select-text">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-5 space-y-1 text-sm select-text">{children}</ol>,
          li: ({ children }) => <li className="text-sm select-text">{children}</li>,
          pre: ({ children }) => <pre className="overflow-x-auto rounded-xl border border-zinc-700 bg-zinc-950/80 p-3 text-xs leading-relaxed mb-4 select-text">{children}</pre>,
          code: ({ inline, children, ...props }: MarkdownCodeComponentProps) => {
            if (inline) {
              return <code className="text-cyan-300 bg-cyan-400/10 px-1.5 py-0.5 rounded text-xs select-text">{children}</code>;
            }
            return <code className="text-zinc-200 select-text" {...props}>{children}</code>;
          },
          table: ({ children }) => (
            <div className="my-4 overflow-x-auto rounded-xl border border-zinc-700 bg-zinc-900/60 select-text">
              <table className="min-w-full border-collapse text-sm text-zinc-200 select-text">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-zinc-800/80 select-text">{children}</thead>,
          th: ({ children }) => <th className="border border-zinc-700 px-3 py-2 text-left text-xs uppercase tracking-wide text-zinc-300 select-text">{children}</th>,
          td: ({ children }) => <td className="border border-zinc-800 px-3 py-2 align-top text-sm select-text">{children}</td>,
          blockquote: ({ children }) => <blockquote className="my-4 border-l-4 border-zinc-600 pl-4 italic select-text">{children}</blockquote>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});

function QuizQuestionMarkdown({ content }: { content: string }) {
  return (
    <div className="prose prose-invert max-w-none prose-p:text-zinc-100 prose-p:text-base prose-p:leading-relaxed prose-p:my-2 prose-strong:text-cyan-300 prose-code:text-cyan-200 prose-code:bg-cyan-400/10 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-pre:my-3 prose-pre:bg-zinc-950/90 prose-pre:border prose-pre:border-zinc-700 prose-pre:rounded-xl prose-pre:p-3 prose-pre:overflow-x-auto">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          p: ({ children }) => <p className="text-zinc-100 text-base leading-relaxed my-2">{children}</p>,
          pre: ({ children }) => <pre className="overflow-x-auto rounded-xl border border-zinc-700 bg-zinc-950/90 p-3 text-xs leading-relaxed my-3">{children}</pre>,
          code: ({ inline, children, ...props }: MarkdownCodeComponentProps) => {
            if (inline) {
              return <code className="text-cyan-200 bg-cyan-400/10 px-1.5 py-0.5 rounded text-xs">{children}</code>;
            }
            return <code className="text-zinc-100" {...props}>{children}</code>;
          },
          ul: ({ children }) => <ul className="my-2 pl-5 list-disc text-zinc-100">{children}</ul>,
          li: ({ children }) => <li className="my-1 text-zinc-100 text-sm">{children}</li>,
          blockquote: ({ children }) => <blockquote className="my-3 border-l-4 border-zinc-600 pl-3 text-zinc-200 italic">{children}</blockquote>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function ReadingTrackerBadge({ isIdle, activeMinutes }: { isIdle: boolean; activeMinutes: number }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-full text-sm text-gray-300">
      <span className={isIdle ? 'w-2 h-2 rounded-full bg-gray-500' : 'w-2 h-2 rounded-full bg-green-500 animate-pulse'} />
      <span>{isIdle ? 'Tạm dừng' : `Đọc: ${activeMinutes}p`}</span>
    </div>
  );
}

export default function LearningWorkspace() {
  const { lessonId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    completeLesson,
    applyServerExp,
    syncServerGamification,
    syncGamificationProfile,
    requestGamificationRefresh,
  } = useApp();

  const [lessonDetail, setLessonDetail] = useState<LessonDetail | null>(null);
  const [activeTab, setActiveTab] = useState<LearningTab>('theory');
  const [isLoading, setIsLoading] = useState(true);
  const [isGeneratingContent, setIsGeneratingContent] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isCompleted, setIsCompleted] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [showCompletionBadge, setShowCompletionBadge] = useState(false);
  const [showCompletionModal, setShowCompletionModal] = useState(false);
  const [completionMessage, setCompletionMessage] = useState<string>('');
  const [completeError, setCompleteError] = useState<string | null>(null);

  const [quizData, setQuizData] = useState<QuizResponseDTO | null>(null);
  const [quizState, setQuizState] = useState<QuizState>({ currentIndex: 0, selectedAnswers: {} });
  const [isQuizLoading, setIsQuizLoading] = useState(false);
  const [hasQuizFetchAttempted, setHasQuizFetchAttempted] = useState(false);
  const [isQuizGenerating, setIsQuizGenerating] = useState(false);
  const [quizLoadError, setQuizLoadError] = useState<string | null>(null);
  const [quizGenerateError, setQuizGenerateError] = useState<string | null>(null);
  const [isQuizSubmitting, setIsQuizSubmitting] = useState(false);
  const [quizSubmitError, setQuizSubmitError] = useState<string | null>(null);
  const [quizResult, setQuizResult] = useState<QuizSubmitResponseDTO | null>(null);
  const [isQuizSubmitted, setIsQuizSubmitted] = useState(false);
  const [regenerationCount, setRegenerationCount] = useState(0);
  const [quizRegenerateRetryAfterSeconds, setQuizRegenerateRetryAfterSeconds] = useState(0);
  const [showQuizRegenerateConfirm, setShowQuizRegenerateConfirm] = useState(false);

  const [isMarkingFlashcardComplete, setIsMarkingFlashcardComplete] = useState(false);
  const [flashcardError, setFlashcardError] = useState<string | null>(null);

  const quizQuestions = quizData?.questions ?? [];
  const currentQuizQuestion = quizQuestions[quizState.currentIndex];
  const hasRegenerateCooldown = quizRegenerateRetryAfterSeconds > 0;
  const canRegenerate = isQuizSubmitted && !hasRegenerateCooldown;
  const regenerateTooltip = !isQuizSubmitted
    ? 'Vui lòng nộp bài để có thể tạo đề mới'
    : hasRegenerateCooldown
      ? `Bạn đã hết lượt tạo trong 10 phút. Thử lại sau ${quizRegenerateRetryAfterSeconds} giây`
      : 'Tạo bộ câu hỏi mới';
  const isRegenerateDisabled = !canRegenerate || isQuizGenerating || isQuizSubmitting || isQuizLoading;

  const resetQuizSessionState = useCallback(() => {
    setQuizState({ currentIndex: 0, selectedAnswers: {} });
    setQuizResult(null);
    setQuizSubmitError(null);
    setIsQuizSubmitted(false);
  }, []);

  const setLearningTab = useCallback((tab: LearningTab) => {
    setActiveTab(tab);
    const next = new URLSearchParams(searchParams);
    if (tab === 'theory') {
      next.delete('tab');
    } else {
      next.set('tab', tab);
    }
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    const requestedTab = searchParams.get('tab');
    const nextTab: LearningTab = isLearningTab(requestedTab) ? requestedTab : 'theory';
    setActiveTab(prev => (prev === nextTab ? prev : nextTab));
  }, [searchParams]);

  const applyTrackResponseToContext = useCallback((result: GamificationTrackResponseDTO) => {
    syncGamificationProfile({
      level: result.level,
      current_exp: result.current_exp,
      target_exp: result.target_exp,
      total_exp: result.total_exp,
      current_streak: result.current_streak,
    });

    if (result.accepted) {
      requestGamificationRefresh();
    }
  }, [requestGamificationRefresh, syncGamificationProfile]);

  const handleTrackFlashcardLearned = useCallback(async (flashcardId: string | number) => {
    try {
      const result = await trackGamification({
        action_type: 'LEARN_FLASHCARD',
        target_id: String(flashcardId),
        value: 1,
      });
      applyTrackResponseToContext(result);
    } catch {
      // Ignore tracking failures to keep flashcard interaction smooth.
    }
  }, [applyTrackResponseToContext]);

  const handleTrackReadingMinute = useCallback(async (documentId: string) => {
    try {
      const result = await trackGamification({
        action_type: 'READ_DOCUMENT',
        target_id: documentId,
        value: 1,
      });
      applyTrackResponseToContext(result);
    } catch {
      // Keep reading UX uninterrupted when background tracking fails.
    }
  }, [applyTrackResponseToContext]);

  const isReadingTrackingEnabled = Boolean(
    lessonId
    && activeTab === 'theory'
    && !isLoading
    && !isGeneratingContent
    && !loadError
    && lessonDetail?.contentMarkdown,
  );

  const readingTracker = useReadingTracker({
    enabled: isReadingTrackingEnabled,
    documentId: lessonId,
    onTrackMinute: handleTrackReadingMinute,
  });

  const loadLesson = useCallback(async (targetLessonId: string) => {
    setIsLoading(true);
    setLoadError(null);
    setGenerationError(null);
    setShowCompletionModal(false);

    try {
      const detail = await getLessonDetail(targetLessonId);
      setLessonDetail(detail);
      setIsCompleted(detail.isCompleted);

      const missingContent = !detail.contentMarkdown || !detail.contentMarkdown.trim() || detail.isDraft;
      if (missingContent) {
        setIsGeneratingContent(true);
        try {
          const generatedDetail = await generateLesson(targetLessonId);
          setLessonDetail(generatedDetail);
        } catch (error) {
          if (axios.isAxiosError(error)) {
            setGenerationError(error.response?.data?.message ?? 'Không thể tạo nội dung bài học lúc này.');
          } else if (error instanceof Error) {
            setGenerationError(error.message);
          } else {
            setGenerationError('Không thể tạo nội dung bài học lúc này.');
          }
        } finally {
          setIsGeneratingContent(false);
        }
      }
    } catch (error) {
      if (axios.isAxiosError(error)) {
        setLoadError(error.response?.data?.message ?? 'Không thể tải thông tin bài học.');
      } else if (error instanceof Error) {
        setLoadError(error.message);
      } else {
        setLoadError('Không thể tải thông tin bài học.');
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!lessonId) return;
    setQuizData(null);
    setQuizState({ currentIndex: 0, selectedAnswers: {} });
    setIsQuizLoading(false);
    setHasQuizFetchAttempted(false);
    setIsQuizGenerating(false);
    setQuizLoadError(null);
    setQuizGenerateError(null);
    setIsQuizSubmitting(false);
    setQuizSubmitError(null);
    setQuizResult(null);
    setIsQuizSubmitted(false);
    setRegenerationCount(0);
    setQuizRegenerateRetryAfterSeconds(0);
    setShowQuizRegenerateConfirm(false);
    setIsMarkingFlashcardComplete(false);
    setFlashcardError(null);
    void loadLesson(lessonId);
  }, [lessonId, loadLesson]);

  useEffect(() => {
    if (quizRegenerateRetryAfterSeconds <= 0) {
      return;
    }

    const timerId = window.setInterval(() => {
      setQuizRegenerateRetryAfterSeconds(prev => (prev > 0 ? prev - 1 : 0));
    }, 1000);

    return () => window.clearInterval(timerId);
  }, [quizRegenerateRetryAfterSeconds]);

  const loadQuiz = useCallback(async (targetLessonId: string) => {
    setIsQuizLoading(true);
    setQuizLoadError(null);
    try {
      const quiz = await fetchQuizByDocument(targetLessonId);
      const restoredAttempt = quiz.attempt ?? null;
      const restoredSelectedAnswers = normalizeSelectedAnswersMap(restoredAttempt?.selected_answers ?? {});

      setQuizData(quiz);
      setQuizState({ currentIndex: 0, selectedAnswers: restoredSelectedAnswers });
      setQuizResult(restoredAttempt);
      setQuizSubmitError(null);
      setIsQuizSubmitted(Boolean(restoredAttempt));
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 404 || error.response?.data?.detail?.code === 'QUIZ_NOT_FOUND') {
          setQuizData(null);
          setQuizLoadError(null);
          return;
        }

        const errorCode = error.response?.data?.detail?.code;
        if (errorCode === 'LLM_API_KEY_MISSING') {
          setQuizLoadError('Quiz AI chưa được cấu hình. Vui lòng thiết lập GEMINI_API_KEY trong backend/.env.');
        } else if (errorCode === 'LLM_AUTH_FAILED') {
          setQuizLoadError('Khóa API AI không hợp lệ. Vui lòng kiểm tra GEMINI_API_KEY.');
        } else if (errorCode === 'LLM_QUOTA_EXCEEDED') {
          setQuizLoadError('Đã vượt hạn mức AI hiện tại. Vui lòng kiểm tra quota/billing Gemini hoặc thử lại sau.');
        } else {
          setQuizLoadError(error.response?.data?.message ?? 'Không thể tải quiz lúc này.');
        }
      } else if (error instanceof Error) {
        setQuizLoadError(error.message);
      } else {
        setQuizLoadError('Không thể tải quiz lúc này.');
      }
    } finally {
      setIsQuizLoading(false);
      setHasQuizFetchAttempted(true);
    }
  }, []);

  const handleGenerateQuiz = useCallback(async (options?: { resetExistingSession?: boolean }) => {
    if (!lessonId || isQuizGenerating || isQuizSubmitting) {
      return;
    }

    setIsQuizGenerating(true);
    setQuizGenerateError(null);
    setQuizLoadError(null);

    try {
      const quiz = await generateQuizByDocument(lessonId);
      setQuizData(quiz);
      resetQuizSessionState();
      setQuizRegenerateRetryAfterSeconds(0);
      if (options?.resetExistingSession) {
        setRegenerationCount(prev => prev + 1);
      }
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const errorCode = error.response?.data?.detail?.code;
        if (errorCode === 'LLM_QUOTA_EXCEEDED') {
          setQuizGenerateError('Đã vượt hạn mức AI hiện tại. Vui lòng kiểm tra quota/billing Gemini hoặc thử lại sau.');
        } else if (error.response?.status === 429) {
          const retryAfter = parseRetryAfterSeconds(error.response?.data?.detail?.retry_after_seconds);
          setQuizRegenerateRetryAfterSeconds(retryAfter);
          setQuizGenerateError(
            retryAfter
              ? `Bạn tạo quiz quá nhanh. Vui lòng thử lại sau ${retryAfter} giây.`
              : 'Bạn tạo quiz quá nhanh. Vui lòng thử lại sau ít phút.'
          );
        } else if (error.response?.status === 403 || error.response?.data?.detail?.code === 'QUIZ_REGENERATION_REQUIRES_SUBMISSION') {
          setQuizGenerateError(error.response?.data?.message ?? 'Vui lòng nộp bài để có thể tạo đề mới.');
        } else {
          setQuizGenerateError(error.response?.data?.message ?? 'Không thể tạo bộ quiz lúc này.');
        }
      } else if (error instanceof Error) {
        setQuizGenerateError(error.message);
      } else {
        setQuizGenerateError('Không thể tạo bộ quiz lúc này.');
      }
    } finally {
      setIsQuizGenerating(false);
    }
  }, [lessonId, isQuizGenerating, isQuizSubmitting, resetQuizSessionState]);

  const handleRequestRegenerateQuiz = useCallback(() => {
    if (!quizData || isRegenerateDisabled) {
      return;
    }
    setShowQuizRegenerateConfirm(true);
  }, [quizData, isRegenerateDisabled]);

  const handleConfirmRegenerateQuiz = useCallback(() => {
    if (isRegenerateDisabled) {
      setShowQuizRegenerateConfirm(false);
      return;
    }
    setShowQuizRegenerateConfirm(false);
    void handleGenerateQuiz({ resetExistingSession: true });
  }, [handleGenerateQuiz, isRegenerateDisabled]);

  useEffect(() => {
    if (activeTab !== 'quiz' || !lessonId || quizData || isQuizLoading || quizLoadError || hasQuizFetchAttempted) {
      return;
    }
    void loadQuiz(lessonId);
  }, [activeTab, lessonId, quizData, isQuizLoading, quizLoadError, hasQuizFetchAttempted, loadQuiz]);

  const retryGeneration = async () => {
    if (!lessonId) return;
    setGenerationError(null);
    setIsGeneratingContent(true);
    try {
      const generatedDetail = await generateLesson(lessonId);
      setLessonDetail(generatedDetail);
    } catch (error) {
      if (axios.isAxiosError(error)) {
        setGenerationError(error.response?.data?.message ?? 'Không thể tạo nội dung bài học lúc này.');
      } else if (error instanceof Error) {
        setGenerationError(error.message);
      } else {
        setGenerationError('Không thể tạo nội dung bài học lúc này.');
      }
    } finally {
      setIsGeneratingContent(false);
    }
  };

  const handleSelectQuizAnswer = (optionKey: string) => {
    if (!currentQuizQuestion) {
      return;
    }

    setQuizState(prev => ({
      ...prev,
      selectedAnswers: {
        ...prev.selectedAnswers,
        [currentQuizQuestion.question_id]: optionKey,
      },
    }));
  };

  const handleSubmitQuiz = async () => {
    if (!lessonId || !quizData || isQuizSubmitting) {
      return;
    }

    setIsQuizSubmitting(true);
    setQuizSubmitError(null);

    try {
      const selectedAnswersPayload = normalizeSelectedAnswersMap(quizState.selectedAnswers);
      const result = await submitQuizByDocument(lessonId, { selected_answers: selectedAnswersPayload });
      const totalExpGained = (result.exp_gained ?? 0) + (result.streak_bonus_exp ?? 0);
      applyServerExp(totalExpGained);
      syncServerGamification({
        totalExp: result.total_exp,
        level: result.level,
        currentStreak: result.current_streak,
      });

      if (quizData?.quiz_id) {
        try {
          const questTrack = await trackGamification({
            action_type: 'QUIZ_COMPLETED',
            target_id: String(quizData.quiz_id),
            value: 1,
          });
          applyTrackResponseToContext(questTrack);
        } catch {
          // Quiz submit result remains successful even if background quest tracking fails.
        }
      }

      setQuizResult(result);
      setQuizState(prev => ({
        ...prev,
        selectedAnswers: normalizeSelectedAnswersMap(result.selected_answers ?? selectedAnswersPayload),
      }));
      setIsQuizSubmitted(true);
      if (result.is_passed) {
        setLessonDetail(prev => (prev ? { ...prev, quizPassed: true } : prev));
        setShowCompletionModal(false);
      }
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 429) {
        const retryAfter = error.response?.data?.detail?.retry_after_seconds ?? '?';
        setQuizSubmitError(`Bạn đã sai hơi nhiều, hãy thử lại sau ${retryAfter} giây.`);
      } else if (axios.isAxiosError(error)) {
        setQuizSubmitError(error.response?.data?.message ?? 'Không thể nộp quiz lúc này.');
      } else if (error instanceof Error) {
        setQuizSubmitError(error.message);
      } else {
        setQuizSubmitError('Không thể nộp quiz lúc này.');
      }
    } finally {
      setIsQuizSubmitting(false);
    }
  };

  const handleNextQuizQuestion = () => {
    if (!quizData || !currentQuizQuestion) {
      return;
    }

    if (quizState.currentIndex < quizQuestions.length - 1) {
      setQuizState(prev => ({ ...prev, currentIndex: prev.currentIndex + 1 }));
      return;
    }

    void handleSubmitQuiz();
  };

  const handleRestartQuiz = () => {
    setQuizState({ currentIndex: 0, selectedAnswers: {} });
    setQuizResult(null);
    setQuizSubmitError(null);
    setIsQuizSubmitted(false);
  };

  const handleFlashcardComplete = async (_known: number, _total: number) => {
    if (!lessonId || isMarkingFlashcardComplete || lessonDetail?.flashcardCompleted) {
      return;
    }

    setIsMarkingFlashcardComplete(true);
    setFlashcardError(null);
    try {
      const result = await completeFlashcardProgress(lessonId);
      if (result.flashcard_completed) {
        setLessonDetail(prev => (prev ? { ...prev, flashcardCompleted: true } : prev));
      }
    } catch (error) {
      if (axios.isAxiosError(error)) {
        setFlashcardError(error.response?.data?.message ?? 'Không thể ghi nhận flashcard lúc này.');
      } else if (error instanceof Error) {
        setFlashcardError(error.message);
      } else {
        setFlashcardError('Không thể ghi nhận flashcard lúc này.');
      }
    } finally {
      setIsMarkingFlashcardComplete(false);
    }
  };

  const handleComplete = async () => {
    if (!lessonId || isCompleted) return;

    setIsCompleting(true);
    setCompleteError(null);
    try {
      const result = await completeLessonProgress(lessonId);
      completeLesson(lessonId);
      const totalExpGained = result.exp_gained + (result.streak_bonus_exp ?? 0);
      applyServerExp(totalExpGained);
      syncServerGamification({
        totalExp: result.total_exp,
        level: result.level,
        currentStreak: result.current_streak,
      });
      setIsCompleted(true);
      setLessonDetail(prev => (prev ? { ...prev, isCompleted: true } : prev));
      setCompletionMessage(totalExpGained > 0
        ? `+${totalExpGained} EXP · Cấp ${result.level} · Chuỗi ${result.current_streak} ngày`
        : result.message || 'Bài học đã được ghi nhận, chưa có EXP mới.');
      setShowCompletionBadge(true);
      setTimeout(() => setShowCompletionBadge(false), 3000);
      if (!(lessonDetail?.quizPassed ?? false)) {
        setShowCompletionModal(true);
      }
    } catch (error) {
      if (axios.isAxiosError(error)) {
        setCompleteError(error.response?.data?.message ?? 'Không thể hoàn thành bài học lúc này.');
      } else if (error instanceof Error) {
        setCompleteError(error.message);
      } else {
        setCompleteError('Không thể hoàn thành bài học lúc này.');
      }
    } finally {
      setIsCompleting(false);
    }
  };

  if (!lessonId) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <BookOpen size={48} className="text-zinc-700" />
        <p className="text-zinc-400">Chưa có tài liệu nào được chọn</p>
        <button onClick={() => navigate('/create')} className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-sm">
          Tạo tài liệu mới
        </button>
      </div>
    );
  }

  const renderTheoryPanel = () => {
    if (!loadError && (isLoading || isGeneratingContent)) {
      return (
        <div className="space-y-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="space-y-2">
              <div className="h-4 bg-zinc-800 rounded-full animate-pulse" style={{ width: `${60 + Math.random() * 30}%` }} />
              <div className="h-3 bg-zinc-800 rounded-full animate-pulse" style={{ width: `${80 + Math.random() * 15}%` }} />
              <div className="h-3 bg-zinc-800 rounded-full animate-pulse" style={{ width: `${50 + Math.random() * 30}%` }} />
            </div>
          ))}
          <div className="flex items-center gap-3 py-4">
            <Loader2 size={20} className="text-cyan-400 animate-spin" />
            <span className="text-zinc-300 text-sm" style={{ fontWeight: 600 }}>
              AI đang biên soạn nội dung chi tiết cho bài học này, vui lòng đợi...
            </span>
          </div>
        </div>
      );
    }

    if (!loadError && generationError) {
      return (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-4">
          <p className="text-sm text-red-300">{generationError}</p>
          <button
            onClick={() => void retryGeneration()}
            className="mt-3 inline-flex items-center gap-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 px-3 py-2 text-xs text-zinc-100"
          >
            <Loader2 size={12} />Thử tạo lại
          </button>
        </div>
      );
    }

    if (!loadError && lessonDetail?.contentMarkdown) {
      return (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8">
          <div>
            <div className="flex items-center gap-2 mb-4">
              <div className="w-6 h-6 rounded-lg bg-blue-500/20 border border-blue-500/30 flex items-center justify-center">
                <BookOpen size={13} className="text-blue-400" />
              </div>
              <h2 className="text-lg text-white" style={{ fontWeight: 600 }}>Nội dung bài học</h2>
            </div>
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
              <MarkdownContent content={lessonDetail.contentMarkdown} />
            </div>
          </div>
        </motion.div>
      );
    }

    if (!loadError) {
      return (
        <div className="rounded-2xl border border-zinc-700 bg-zinc-900 px-4 py-4">
          <p className="text-sm text-zinc-300">Nội dung bài học đang trong trạng thái bản nháp.</p>
          <button
            onClick={() => void retryGeneration()}
            className="mt-3 inline-flex items-center gap-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 px-3 py-2 text-xs text-white"
          >
            <Zap size={12} />Tạo nội dung ngay
          </button>
        </div>
      );
    }

    return null;
  };

  const renderQuizPanel = () => {
    if (isQuizLoading) {
      return (
        <div className="rounded-2xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-5 flex items-center gap-3">
          <Loader2 size={18} className="text-cyan-300 animate-spin" />
          <p className="text-sm text-cyan-200">Đang tải dữ liệu quiz cho bài học này...</p>
        </div>
      );
    }

    if (isQuizGenerating) {
      return (
        <div className="rounded-2xl border border-cyan-500/30 bg-cyan-500/10 px-5 py-6 space-y-4">
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/40 bg-cyan-500/20 px-3 py-1.5 text-xs text-cyan-100" style={{ fontWeight: 700 }}>
            <Loader2 size={13} className="animate-spin" />AI đang tạo bộ 10 câu hỏi...
          </div>
          <p className="text-sm text-cyan-100/90">
            Quá trình sinh quiz có thể mất khoảng 10-20 giây. Vui lòng đợi trong giây lát.
          </p>
          <div className="space-y-2">
            {[...Array(3)].map((_, index) => (
              <div key={`quiz-skeleton-${index}`} className="h-10 rounded-lg bg-cyan-500/15 border border-cyan-400/20 animate-pulse" />
            ))}
          </div>
        </div>
      );
    }

    if (quizLoadError) {
      return (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-4">
          <p className="text-sm text-red-300">{quizLoadError}</p>
          <button
            onClick={() => lessonId && void loadQuiz(lessonId)}
            className="mt-3 inline-flex items-center gap-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 px-3 py-2 text-xs text-zinc-100"
          >
            <Loader2 size={12} />Thử tải quiz
          </button>
        </div>
      );
    }

    if (!quizData || quizQuestions.length === 0) {
      return (
        <div className="rounded-2xl border border-zinc-700 bg-zinc-900 px-5 py-6">
          <h3 className="text-lg text-white" style={{ fontWeight: 700 }}>Chưa có bài trắc nghiệm</h3>
          <p className="mt-2 text-sm text-zinc-300">Tạo bộ 10 câu hỏi tự động bằng AI để luyện tập ngay trên tài liệu này.</p>
          <button
            onClick={() => void handleGenerateQuiz()}
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 px-5 py-3 text-sm text-white"
            style={{ fontWeight: 700 }}
          >
            <Zap size={16} />Tạo bộ 10 câu trắc nghiệm AI
          </button>
          {quizGenerateError && (
            <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {quizGenerateError}
            </div>
          )}
        </div>
      );
    }

    if (quizResult) {
      return (
        <QuizResultDisplay
          quizResult={quizResult}
          quizQuestions={quizQuestions}
          onRetry={handleRestartQuiz}
          onBackToTheory={() => setLearningTab('theory')}
          onRegenerate={handleRequestRegenerateQuiz}
          isRegenerating={isQuizGenerating}
          isRegenerateDisabled={isRegenerateDisabled}
          regenerateTooltip={regenerateTooltip}
          regenerationCount={regenerationCount}
        />
      );
    }

    const selectedKey = currentQuizQuestion ? quizState.selectedAnswers[currentQuizQuestion.question_id] : undefined;

    return (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-zinc-400">Câu {quizState.currentIndex + 1}/{quizQuestions.length}</p>
          <p className="text-xs text-cyan-300">Đã chọn {Object.keys(quizState.selectedAnswers).length} đáp án</p>
        </div>

        {isRegenerateDisabled && (
          <div className="rounded-lg border border-zinc-700 bg-zinc-950/60 px-3 py-2 text-xs text-zinc-300">
            {regenerateTooltip}
          </div>
        )}

        <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
          <motion.div
            animate={{ width: `${quizQuestions.length > 0 ? (quizState.currentIndex / quizQuestions.length) * 100 : 0}%` }}
            className="h-full bg-cyan-500 rounded-full"
          />
        </div>

        <div className="rounded-xl border border-zinc-700 bg-zinc-950/60 p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-cyan-500/40 bg-cyan-500/15 px-2.5 py-1 text-xs text-cyan-200" style={{ fontWeight: 600 }}>
              {getQuizTypeLabel(currentQuizQuestion?.type)}
            </span>
            <span
              className={`rounded-full border px-2.5 py-1 text-xs ${getQuizDifficultyStyle(currentQuizQuestion?.difficulty)}`}
              style={{ fontWeight: 600 }}
            >
              {currentQuizQuestion?.difficulty ?? 'N/A'}
            </span>
          </div>
          <QuizQuestionMarkdown content={currentQuizQuestion?.text ?? ''} />
        </div>

        <div className="space-y-3">
          {currentQuizQuestion?.options.map(option => {
            const isSelected = selectedKey === option.option_key;
            const cleanOption = cleanQuizOptionText(option.text);
            return (
              <button
                key={option.option_key}
                onClick={() => handleSelectQuizAnswer(option.option_key)}
                className={`w-full text-left rounded-xl border px-4 py-3 text-sm transition-colors ${!selectedKey ? 'border-zinc-700 bg-zinc-900 hover:border-zinc-500 hover:bg-zinc-800 text-zinc-200' : isSelected ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-100' : 'border-zinc-800 bg-zinc-900 text-zinc-500'}`}
              >
                <span className="inline-flex items-center gap-2">
                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-full border border-current text-xs" style={{ fontWeight: 600 }}>
                    {option.option_key}
                  </span>
                  {cleanOption}
                </span>
              </button>
            );
          })}
        </div>

        <button
          onClick={handleNextQuizQuestion}
          disabled={!selectedKey || isQuizSubmitting}
          className="w-full rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-60 disabled:cursor-not-allowed text-white px-4 py-2.5 text-sm"
          style={{ fontWeight: 600 }}
        >
          {quizState.currentIndex < quizQuestions.length - 1
            ? 'Câu tiếp theo'
            : (isQuizSubmitting ? 'Đang nộp quiz...' : 'Nộp quiz')}
        </button>

        {quizSubmitError && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {quizSubmitError}
          </div>
        )}
      </div>
    );
  };

  const renderFlashcardPanel = () => {
    return (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 sm:p-6">
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span className="text-xs text-zinc-500">Flashcard từ dữ liệu backend</span>
          {lessonDetail?.flashcardCompleted && (
            <span className="text-xs rounded-full px-2.5 py-1 border border-cyan-500/40 bg-cyan-500/15 text-cyan-300">
              Flashcard đã hoàn thành
            </span>
          )}
          {isMarkingFlashcardComplete && (
            <span className="text-xs rounded-full px-2.5 py-1 border border-cyan-500/40 bg-cyan-500/15 text-cyan-300 inline-flex items-center gap-1.5">
              <Loader2 size={12} className="animate-spin" />Đang ghi nhận
            </span>
          )}
        </div>

        <FlashCardDeck
          documentId={lessonId}
          onComplete={(known, total) => {
            void handleFlashcardComplete(known, total);
          }}
          onMarkLearned={(flashcardId) => {
            void handleTrackFlashcardLearned(flashcardId);
          }}
        />

        {flashcardError && (
          <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {flashcardError}
          </div>
        )}
      </div>
    );
  };

  const renderQAPanel = () => {
    return (
      <AITutorChat documentId={lessonId ?? ''} />
    );
  };

  return (
    <div className="flex h-full">
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 overflow-y-auto">
          <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-3 bg-zinc-950/90 backdrop-blur-sm border-b border-zinc-800">
            <div className="text-xs text-zinc-500">
              <span className="text-cyan-400">Learning Workspace</span>
              <span className="mx-1">›</span>
              <span>{lessonDetail?.title ?? 'Đang tải...'}</span>
            </div>
            <span className="text-[11px] text-zinc-500">NEXL</span>
          </div>

          <div className="max-w-3xl mx-auto px-6 py-8 space-y-8">
            {/* Lesson title */}
            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
              <h1 className="text-3xl text-white" style={{ fontWeight: 700 }}>
                {lessonDetail?.title ?? 'Bài học'}
              </h1>
              <p className="text-zinc-500 text-sm mt-1">
                {lessonDetail
                  ? 'Tài liệu đang được học theo chế độ NEXL.'
                  : 'Đang tải thông tin bài học...'}
              </p>
            </motion.div>

            {loadError && (
              <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3">
                <p className="text-sm text-red-300">{loadError}</p>
                <button
                  onClick={() => lessonId && void loadLesson(lessonId)}
                  className="mt-3 inline-flex items-center gap-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 px-3 py-2 text-xs text-zinc-100"
                >
                  <Loader2 size={12} />Thử tải lại
                </button>
              </div>
            )}

              {!loadError && lessonDetail && (
                <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-1.5 sm:p-2 grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                  <button
                    onClick={() => setLearningTab('theory')}
                    className={`rounded-xl px-3 py-2.5 text-sm flex items-center justify-center gap-2 transition-colors ${activeTab === 'theory' ? 'bg-cyan-600 text-white' : 'text-zinc-300 hover:bg-zinc-800'}`}
                    style={{ fontWeight: 600 }}
                  >
                    <BookOpen size={15} />Lý thuyết
                  </button>
                  <button
                    onClick={() => setLearningTab('quiz')}
                    className={`rounded-xl px-3 py-2.5 text-sm flex items-center justify-center gap-2 transition-colors ${activeTab === 'quiz' ? 'bg-cyan-600 text-white' : lessonDetail.quizPassed ? 'text-emerald-300 hover:bg-emerald-500/10' : 'text-zinc-300 hover:bg-zinc-800'}`}
                    style={{ fontWeight: 600 }}
                  >
                    <ListChecks size={15} />Quiz
                    {lessonDetail.quizPassed && <CheckCircle2 size={14} className="text-emerald-300" />}
                  </button>
                  <button
                    onClick={() => setLearningTab('flashcard')}
                    className={`rounded-xl px-3 py-2.5 text-sm flex items-center justify-center gap-2 transition-colors ${activeTab === 'flashcard' ? 'bg-cyan-600 text-white' : lessonDetail.flashcardCompleted ? 'text-cyan-300 hover:bg-cyan-500/10' : 'text-zinc-300 hover:bg-zinc-800'}`}
                    style={{ fontWeight: 600 }}
                  >
                    <CreditCard size={15} />Flashcard
                    {lessonDetail.flashcardCompleted && <CheckCircle2 size={14} className="text-cyan-300" />}
                  </button>
                  <button
                    onClick={() => setLearningTab('qa')}
                    className={`rounded-xl px-3 py-2.5 text-sm flex items-center justify-center gap-2 transition-colors ${activeTab === 'qa' ? 'bg-emerald-600 text-white' : 'text-zinc-300 hover:bg-zinc-800'}`}
                    style={{ fontWeight: 600 }}
                  >
                    <MessageSquare size={15} />Hỏi đáp
                  </button>
                </div>
              )}

              {!loadError && activeTab === 'theory' && renderTheoryPanel()}
              {!loadError && activeTab === 'quiz' && renderQuizPanel()}
              {!loadError && activeTab === 'flashcard' && renderFlashcardPanel()}
              {!loadError && activeTab === 'qa' && renderQAPanel()}
          </div>

          {/* Complete */}
          <div className="sticky bottom-0 bg-zinc-950/95 backdrop-blur-sm border-t border-zinc-800 px-6 py-4">
            <div className="max-w-3xl mx-auto flex items-center justify-end">
              <div className="flex items-center gap-4">
                {isReadingTrackingEnabled && (
                  <ReadingTrackerBadge isIdle={readingTracker.isIdle} activeMinutes={readingTracker.activeMinutes} />
                )}

                <button
                  onClick={handleComplete}
                  disabled={isCompleted || isCompleting}
                  className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm transition-all ${
                    isCompleted
                      ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 cursor-default'
                      : 'bg-cyan-600 hover:bg-cyan-500 text-white'
                  }`}
                  style={{ fontWeight: 600 }}
                >
                  {isCompleted ? (
                    <><CheckCircle2 size={16} />Đã hoàn thành</>
                  ) : (
                    <><Zap size={16} />{isCompleting ? 'Đang ghi nhận...' : 'Hoàn thành bài học'}</>
                  )}
                </button>
              </div>
            </div>
            {completeError && (
              <div className="max-w-3xl mx-auto mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
                {completeError}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Completion badge */}
      <AnimatePresence>
        {showCompletionBadge && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 50, scale: 0.9 }}
            className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-zinc-900 border border-emerald-500/50 rounded-2xl px-6 py-4 flex items-center gap-3 shadow-xl shadow-emerald-500/20 z-50"
          >
            <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center">
              <CheckCircle2 size={22} className="text-emerald-400" />
            </div>
            <div>
              <p className="text-white text-sm" style={{ fontWeight: 700 }}>Bài học hoàn thành! 🎉</p>
              <p className="text-emerald-400 text-xs">{completionMessage}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showCompletionModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.96 }}
              className="w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-900 p-6"
            >
              <div className="w-12 h-12 rounded-xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center mb-4">
                <ListChecks size={22} className="text-cyan-300" />
              </div>
              <h3 className="text-xl text-white" style={{ fontWeight: 700 }}>Hoàn thành bài học rồi, làm quiz tiếp nhé?</h3>
              <p className="text-sm text-zinc-400 mt-2">
                Vượt quiz để nhận thêm EXP và bật icon Quiz Passed cho bài học này.
              </p>

              <div className="mt-6 grid grid-cols-2 gap-3">
                <button
                  onClick={() => setShowCompletionModal(false)}
                  className="rounded-xl px-4 py-2.5 text-sm bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
                  style={{ fontWeight: 600 }}
                >
                  Để sau
                </button>
                <button
                  onClick={() => {
                    setShowCompletionModal(false);
                    setLearningTab('quiz');
                  }}
                  className="rounded-xl px-4 py-2.5 text-sm bg-cyan-600 hover:bg-cyan-500 text-white"
                  style={{ fontWeight: 600 }}
                >
                  Làm ngay
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showQuizRegenerateConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/65 backdrop-blur-sm z-[65] flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.96 }}
              className="w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-900 p-6"
            >
              <div className="w-12 h-12 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center mb-4">
                <RefreshCw size={20} className="text-amber-300" />
              </div>
              <h3 className="text-xl text-white" style={{ fontWeight: 700 }}>Tạo bộ câu hỏi mới?</h3>
              <p className="text-sm text-zinc-300 mt-2">
                Bạn có chắc chắn muốn tạo bộ câu hỏi mới? Toàn bộ kết quả của bài làm hiện tại sẽ bị xóa.
              </p>

              <div className="mt-6 grid grid-cols-2 gap-3">
                <button
                  onClick={() => setShowQuizRegenerateConfirm(false)}
                  className="rounded-xl px-4 py-2.5 text-sm bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
                  style={{ fontWeight: 600 }}
                >
                  Hủy
                </button>
                <button
                  onClick={handleConfirmRegenerateQuiz}
                  disabled={isRegenerateDisabled}
                  className="rounded-xl px-4 py-2.5 text-sm bg-cyan-600 hover:bg-cyan-500 disabled:opacity-60 disabled:cursor-not-allowed text-white inline-flex items-center justify-center gap-2"
                  style={{ fontWeight: 600 }}
                >
                  <RefreshCw size={14} className={isQuizGenerating ? 'animate-spin' : ''} />
                  Xác nhận tạo lại
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
