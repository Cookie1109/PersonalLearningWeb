import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  CheckCircle2, BookOpen,
  Loader2, Zap,
  MessageSquare, CreditCard, ListChecks, Lightbulb
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import {
  completeFlashcardProgress,
  completeLessonProgress,
  generateLesson,
  getLessonDetail,
  LessonDetail,
} from '../../api/learning';
import ChatTutor from '../components/ChatTutor';
import FlashCardDeck from '../components/FlashCard';
import { Flashcard } from '../lib/types';
import { QuizResponseDTO, QuizSubmitResponseDTO } from '../../api/dto';
import { fetchQuizByLesson, submitQuiz } from '../../api/quiz';

type LearningTab = 'theory' | 'quiz' | 'flashcard';

interface QuizState {
  currentIndex: number;
  selectedAnswers: Record<string, string>;
}

interface QuizResultDisplayProps {
  quizResult: QuizSubmitResponseDTO;
  quizQuestions: QuizResponseDTO['questions'];
  onRetry: () => void;
  onBackToTheory: () => void;
}

function isLearningTab(value: string | null): value is LearningTab {
  return value === 'theory' || value === 'quiz' || value === 'flashcard';
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
    'trong bai hoc nay',
    'chung ta se',
    'muc tieu la',
    'ban co the',
    'hay nho rang',
    'duoi day la',
    'moi ban',
  ];

  if (lowSignalStarters.some(prefix => folded.startsWith(prefix)) && !_hasTechnicalSignal(folded)) {
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

  return _buildSeed('cloze', `Dien vao cho trong: ${masked}`, token, seed.section, seed.sourceText);
}

function _buildContextSeed(seeds: FlashcardSeed[], entries: KnowledgeEntry[]): FlashcardSeed | null {
  const corpus = entries.map(entry => `${entry.section} ${entry.text}`).join(' ');
  const foldedCorpus = _foldForMatch(corpus);

  const ruleMatches: Array<{ pattern: RegExp; front: string; back: string }> = [
    {
      pattern: /\b(compiler|gcc|clang|msvc|bien dich|build)\b/,
      front: 'Tinh huong IT: Khi nao ban can chay compiler trong project C++?',
      back: 'Khi can bien ma nguon thanh ma may va bat loi cu phap/type truoc khi chay chuong trinh.',
    },
    {
      pattern: /\b(ide|editor|vs code|vscode|debug)\b/,
      front: 'Tinh huong IT: IDE giup gi khi ban debug mot loi kho?',
      back: 'IDE cho phep dat breakpoint, theo doi bien, va trace tung buoc de khoanh vung nguyen nhan nhanh hon.',
    },
    {
      pattern: /\b(index|database|sql)\b/,
      front: 'Tinh huong IT: Khi nao viec danh index co the lam giam hieu nang?',
      back: 'Khi bang ghi/cap nhat lien tuc hoac cot co do chon loc thap, chi phi cap nhat index lon hon loi ich truy van.',
    },
    {
      pattern: /\b(api|http|request|response|endpoint)\b/,
      front: 'Tinh huong IT: Khi tich hop API, can kiem tra gi de tranh loi runtime?',
      back: 'Kiem tra hop dong input/output, ma loi HTTP, timeout va retry de he thong on dinh trong thuc te.',
    },
  ];

  for (const rule of ruleMatches) {
    if (rule.pattern.test(foldedCorpus)) {
      return _buildSeed('context', rule.front, rule.back, 'Tinh huong IT', rule.back);
    }
  }

  const fallbackSeed = seeds.find(seed => seed.kind === 'concept' || seed.kind === 'process') ?? seeds[0];
  if (!fallbackSeed) {
    return null;
  }

  const topic = _extractTopic(fallbackSeed.section, 'kien thuc nay');
  return _buildSeed(
    'context',
    `Tinh huong IT: Trong du an that, ban ap dung "${topic}" khi nao?`,
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
      const stepLabel = entry.order ? `buoc ${entry.order}` : 'mot buoc quan trong';
      const seed = _buildSeed(
        'process',
        `Trong "${entry.section}", ${stepLabel} can lam gi?`,
        entry.text,
        entry.section,
        entry.text,
      );
      if (seed) {
        processSeeds.push(seed);
      }
      continue;
    }

    const topic = _extractTopic(entry.section === 'Tong quan' ? entry.text : entry.section, 'noi dung nay');
    const seed = _buildSeed(
      'fact',
      `Y chinh can nho ve "${topic}" la gi?`,
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
}: QuizResultDisplayProps) {
  const correctCount = quizResult.results.filter(item => item.is_correct).length;

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6 space-y-5">
      <div className="text-center">
        <p className="text-xs uppercase tracking-wide text-zinc-500">Ket qua quiz</p>
        <p className={`text-5xl mt-2 ${quizResult.is_passed ? 'text-emerald-400' : 'text-amber-400'}`} style={{ fontWeight: 800 }}>
          {quizResult.score}%
        </p>
        <p className="text-zinc-300 text-sm mt-2">{correctCount}/{quizQuestions.length} cau dung</p>
        {quizResult.is_passed ? (
          <p className="text-emerald-300 text-sm mt-2">Ban da dat quiz. Icon Quiz se sang ngay lap tuc.</p>
        ) : (
          <p className="text-amber-300 text-sm mt-2">Chua dat nguong. Hay on lai ly thuyet va thu lai.</p>
        )}
      </div>

      {quizResult.reward_granted && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          Chuc mung! Ban nhan {quizResult.exp_gained} EXP khi vuot quiz lan dau.
        </div>
      )}

      <div className="space-y-2">
        {quizResult.results.map((answer, index) => (
          <div key={answer.question_id} className="space-y-2">
            <div
              className={`rounded-lg border px-3 py-2 text-sm ${answer.is_correct ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100' : 'border-red-500/30 bg-red-500/10 text-red-100'}`}
            >
              Cau {index + 1}: {answer.is_correct ? 'Dung' : 'Sai'}
            </div>
            {!answer.is_correct && answer.explanation && (
              <div className="rounded-lg border border-amber-400/35 bg-amber-400/10 px-3 py-2.5 text-amber-100">
                <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-amber-300" style={{ fontWeight: 700 }}>
                  <Lightbulb size={13} />Giai thich
                </div>
                <p className="mt-1.5 text-sm leading-relaxed text-amber-100/95">{answer.explanation}</p>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="flex gap-3">
        <button
          onClick={onRetry}
          className="flex-1 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-100 px-4 py-2.5 text-sm"
          style={{ fontWeight: 600 }}
        >
          Lam lai quiz
        </button>
        <button
          onClick={onBackToTheory}
          className="flex-1 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white px-4 py-2.5 text-sm"
          style={{ fontWeight: 600 }}
        >
          Quay lai ly thuyet
        </button>
      </div>
    </div>
  );
}

function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="prose prose-invert max-w-none prose-p:text-zinc-300 prose-li:text-zinc-300 prose-strong:text-violet-300 prose-headings:text-white prose-code:text-cyan-300">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h2: ({ children }) => <h2 className="text-xl text-white mt-6 mb-3" style={{ fontWeight: 700 }}>{children}</h2>,
          h3: ({ children }) => <h3 className="text-base text-zinc-200 mt-4 mb-2" style={{ fontWeight: 600 }}>{children}</h3>,
          p: ({ children }) => <p className="text-zinc-300 text-sm leading-relaxed my-2">{children}</p>,
          li: ({ children }) => <li className="text-zinc-300 text-sm my-1">{children}</li>,
          pre: ({ children }) => <pre className="overflow-x-auto rounded-xl border border-zinc-700 bg-zinc-950/80 p-3 text-xs">{children}</pre>,
          code: ({ inline, children, ...props }) => {
            if (inline) {
              return <code className="text-cyan-300 bg-cyan-400/10 px-1.5 py-0.5 rounded text-xs">{children}</code>;
            }
            return <code className="text-zinc-200" {...props}>{children}</code>;
          },
          table: ({ children }) => (
            <div className="my-4 overflow-x-auto rounded-xl border border-zinc-700 bg-zinc-900/60">
              <table className="min-w-full border-collapse text-sm text-zinc-200">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-zinc-800/80">{children}</thead>,
          th: ({ children }) => <th className="border border-zinc-700 px-3 py-2 text-left text-xs uppercase tracking-wide text-zinc-300">{children}</th>,
          td: ({ children }) => <td className="border border-zinc-800 px-3 py-2 align-top text-sm">{children}</td>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export default function LearningWorkspace() {
  const { lessonId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { completeLesson, applyServerExp, syncServerGamification } = useApp();

  const [lessonDetail, setLessonDetail] = useState<LessonDetail | null>(null);
  const [activeTab, setActiveTab] = useState<LearningTab>('theory');
  const [isLoading, setIsLoading] = useState(true);
  const [isGeneratingContent, setIsGeneratingContent] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [showChat, setShowChat] = useState(true);
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
  const [quizLoadError, setQuizLoadError] = useState<string | null>(null);
  const [isQuizSubmitting, setIsQuizSubmitting] = useState(false);
  const [quizSubmitError, setQuizSubmitError] = useState<string | null>(null);
  const [quizResult, setQuizResult] = useState<QuizSubmitResponseDTO | null>(null);

  const [isMarkingFlashcardComplete, setIsMarkingFlashcardComplete] = useState(false);
  const [flashcardError, setFlashcardError] = useState<string | null>(null);

  const flashcards = useMemo(
    () => buildFlashcardsFromMarkdown(lessonDetail?.contentMarkdown ?? null),
    [lessonDetail?.contentMarkdown]
  );
  const quizQuestions = quizData?.questions ?? [];
  const currentQuizQuestion = quizQuestions[quizState.currentIndex];

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
  const youtubeEmbedUrl = lessonDetail?.youtubeVideoId
    ? `https://www.youtube.com/embed/${encodeURIComponent(lessonDetail.youtubeVideoId)}?rel=0`
    : null;

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
            setGenerationError(error.response?.data?.message ?? 'Khong the tao noi dung bai hoc luc nay.');
          } else if (error instanceof Error) {
            setGenerationError(error.message);
          } else {
            setGenerationError('Khong the tao noi dung bai hoc luc nay.');
          }
        } finally {
          setIsGeneratingContent(false);
        }
      }
    } catch (error) {
      if (axios.isAxiosError(error)) {
        setLoadError(error.response?.data?.message ?? 'Khong the tai thong tin bai hoc.');
      } else if (error instanceof Error) {
        setLoadError(error.message);
      } else {
        setLoadError('Khong the tai thong tin bai hoc.');
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
    setQuizLoadError(null);
    setIsQuizSubmitting(false);
    setQuizSubmitError(null);
    setQuizResult(null);
    setIsMarkingFlashcardComplete(false);
    setFlashcardError(null);
    void loadLesson(lessonId);
  }, [lessonId, loadLesson]);

  const loadQuiz = useCallback(async (targetLessonId: string) => {
    setIsQuizLoading(true);
    setQuizLoadError(null);
    try {
      const quiz = await fetchQuizByLesson(targetLessonId);
      setQuizData(quiz);
      setQuizState({ currentIndex: 0, selectedAnswers: {} });
      setQuizResult(null);
      setQuizSubmitError(null);
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const errorCode = error.response?.data?.detail?.code;
        if (errorCode === 'LLM_API_KEY_MISSING') {
          setQuizLoadError('Quiz AI chua duoc cau hinh. Vui long thiet lap GEMINI_API_KEY trong backend/.env.');
        } else if (errorCode === 'LLM_AUTH_FAILED') {
          setQuizLoadError('Khoa API AI khong hop le. Vui long kiem tra GEMINI_API_KEY.');
        } else {
          setQuizLoadError(error.response?.data?.message ?? 'Khong the tai quiz luc nay.');
        }
      } else if (error instanceof Error) {
        setQuizLoadError(error.message);
      } else {
        setQuizLoadError('Khong the tai quiz luc nay.');
      }
    } finally {
      setIsQuizLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab !== 'quiz' || !lessonId || quizData || isQuizLoading || quizLoadError) {
      return;
    }
    void loadQuiz(lessonId);
  }, [activeTab, lessonId, quizData, isQuizLoading, quizLoadError, loadQuiz]);

  const retryGeneration = async () => {
    if (!lessonId) return;
    setGenerationError(null);
    setIsGeneratingContent(true);
    try {
      const generatedDetail = await generateLesson(lessonId);
      setLessonDetail(generatedDetail);
    } catch (error) {
      if (axios.isAxiosError(error)) {
        setGenerationError(error.response?.data?.message ?? 'Khong the tao noi dung bai hoc luc nay.');
      } else if (error instanceof Error) {
        setGenerationError(error.message);
      } else {
        setGenerationError('Khong the tao noi dung bai hoc luc nay.');
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
    if (!quizData || isQuizSubmitting) {
      return;
    }

    setIsQuizSubmitting(true);
    setQuizSubmitError(null);

    try {
      const answers = Object.entries(quizState.selectedAnswers).map(([question_id, selected_option]) => ({
        question_id,
        selected_option,
      }));

      const result = await submitQuiz(quizData.quiz_id, { answers });
      const totalExpGained = (result.exp_gained ?? 0) + (result.streak_bonus_exp ?? 0);
      applyServerExp(totalExpGained);
      syncServerGamification({
        totalExp: result.total_exp,
        level: result.level,
        currentStreak: result.current_streak,
      });

      setQuizResult(result);
      if (result.is_passed) {
        setLessonDetail(prev => (prev ? { ...prev, quizPassed: true } : prev));
        setShowCompletionModal(false);
      }
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 429) {
        const retryAfter = error.response?.data?.detail?.retry_after_seconds ?? '?';
        setQuizSubmitError(`Ban da sai hoi nhieu, hay thu lai sau ${retryAfter} giay.`);
      } else if (axios.isAxiosError(error)) {
        setQuizSubmitError(error.response?.data?.message ?? 'Khong the nop quiz luc nay.');
      } else if (error instanceof Error) {
        setQuizSubmitError(error.message);
      } else {
        setQuizSubmitError('Khong the nop quiz luc nay.');
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
        setFlashcardError(error.response?.data?.message ?? 'Khong the ghi nhan flashcard luc nay.');
      } else if (error instanceof Error) {
        setFlashcardError(error.message);
      } else {
        setFlashcardError('Khong the ghi nhan flashcard luc nay.');
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
        <p className="text-zinc-400">Chua co tai lieu nao duoc chon</p>
        <button onClick={() => navigate('/create')} className="px-4 py-2 rounded-xl bg-violet-600 text-white text-sm">
          Tao tai lieu moi
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
            <Loader2 size={20} className="text-violet-400 animate-spin" />
            <span className="text-zinc-300 text-sm" style={{ fontWeight: 600 }}>
              AI dang bien soan noi dung chi tiet cho bai hoc nay, vui long doi...
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
            <Loader2 size={12} />Thu tao lai
          </button>
        </div>
      );
    }

    if (!loadError && lessonDetail?.contentMarkdown) {
      return (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8">
          {youtubeEmbedUrl ? (
            <div className="grid grid-cols-1 xl:grid-cols-5 gap-6 items-start">
              <div className="xl:col-span-2">
                <div className="rounded-2xl border border-zinc-800 bg-zinc-900 overflow-hidden">
                  <div className="px-4 py-3 border-b border-zinc-800">
                    <h3 className="text-sm text-zinc-100" style={{ fontWeight: 600 }}>Video goi y</h3>
                    <p className="text-xs text-zinc-500 mt-1">Duoc tim tu YouTube theo noi dung bai hoc</p>
                  </div>
                  <div className="aspect-video bg-black">
                    <iframe
                      src={youtubeEmbedUrl}
                      title={`YouTube video for ${lessonDetail.title}`}
                      className="w-full h-full"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                      referrerPolicy="strict-origin-when-cross-origin"
                      allowFullScreen
                    />
                  </div>
                </div>
              </div>

              <div className="xl:col-span-3">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-6 h-6 rounded-lg bg-blue-500/20 border border-blue-500/30 flex items-center justify-center">
                    <BookOpen size={13} className="text-blue-400" />
                  </div>
                  <h2 className="text-lg text-white" style={{ fontWeight: 600 }}>Noi dung bai hoc</h2>
                </div>
                <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
                  <MarkdownContent content={lessonDetail.contentMarkdown} />
                </div>
              </div>
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-6 h-6 rounded-lg bg-blue-500/20 border border-blue-500/30 flex items-center justify-center">
                  <BookOpen size={13} className="text-blue-400" />
                </div>
                <h2 className="text-lg text-white" style={{ fontWeight: 600 }}>Noi dung bai hoc</h2>
              </div>
              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
                <MarkdownContent content={lessonDetail.contentMarkdown} />
              </div>
            </div>
          )}
        </motion.div>
      );
    }

    if (!loadError) {
      return (
        <div className="rounded-2xl border border-zinc-700 bg-zinc-900 px-4 py-4">
          <p className="text-sm text-zinc-300">Noi dung bai hoc dang trong trang thai ban nhap.</p>
          <button
            onClick={() => void retryGeneration()}
            className="mt-3 inline-flex items-center gap-2 rounded-lg bg-violet-600 hover:bg-violet-500 px-3 py-2 text-xs text-white"
          >
            <Zap size={12} />Tao noi dung ngay
          </button>
        </div>
      );
    }

    return null;
  };

  const renderQuizPanel = () => {
    if (isQuizLoading) {
      return (
        <div className="rounded-2xl border border-violet-500/30 bg-violet-500/10 px-4 py-5 flex items-center gap-3">
          <Loader2 size={18} className="text-violet-300 animate-spin" />
          <p className="text-sm text-violet-200">Dang tai du lieu quiz cho bai hoc nay...</p>
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
            <Loader2 size={12} />Thu tai quiz
          </button>
        </div>
      );
    }

    if (!quizData || quizQuestions.length === 0) {
      return (
        <div className="rounded-2xl border border-zinc-700 bg-zinc-900 px-4 py-4">
          <p className="text-sm text-zinc-300">Quiz chua san sang cho bai hoc nay.</p>
          <button
            onClick={() => lessonId && void loadQuiz(lessonId)}
            className="mt-3 inline-flex items-center gap-2 rounded-lg bg-violet-600 hover:bg-violet-500 px-3 py-2 text-xs text-white"
          >
            <Zap size={12} />Tai quiz ngay
          </button>
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
        />
      );
    }

    const selectedKey = currentQuizQuestion ? quizState.selectedAnswers[currentQuizQuestion.question_id] : undefined;

    return (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6 space-y-5">
        <div className="flex items-center justify-between">
          <p className="text-sm text-zinc-400">Cau {quizState.currentIndex + 1}/{quizQuestions.length}</p>
          <p className="text-xs text-cyan-300">Da chon {Object.keys(quizState.selectedAnswers).length} dap an</p>
        </div>

        <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
          <motion.div
            animate={{ width: `${quizQuestions.length > 0 ? (quizState.currentIndex / quizQuestions.length) * 100 : 0}%` }}
            className="h-full bg-cyan-500 rounded-full"
          />
        </div>

        <div className="rounded-xl border border-zinc-700 bg-zinc-950/60 p-4">
          <h3 className="text-lg text-white" style={{ fontWeight: 600 }}>{currentQuizQuestion?.text}</h3>
        </div>

        <div className="space-y-3">
          {currentQuizQuestion?.options.map(option => {
            const isSelected = selectedKey === option.option_key;
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
                  {option.text}
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
            ? 'Cau tiep theo'
            : (isQuizSubmitting ? 'Dang nop quiz...' : 'Nop quiz')}
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
    if (!lessonDetail?.contentMarkdown && (isLoading || isGeneratingContent)) {
      return (
        <div className="rounded-2xl border border-violet-500/30 bg-violet-500/10 px-4 py-5 flex items-center gap-3">
          <Loader2 size={18} className="text-violet-300 animate-spin" />
          <p className="text-sm text-violet-200">Dang chuan bi noi dung de tao flashcard...</p>
        </div>
      );
    }

    if (flashcards.length === 0) {
      return (
        <div className="rounded-2xl border border-zinc-700 bg-zinc-900 px-4 py-4">
          <p className="text-sm text-zinc-300">Chua du thong tin de tao flashcard. Hay tao noi dung ly thuyet truoc.</p>
          <button
            onClick={() => setLearningTab('theory')}
            className="mt-3 inline-flex items-center gap-2 rounded-lg bg-violet-600 hover:bg-violet-500 px-3 py-2 text-xs text-white"
          >
            <BookOpen size={12} />Den tab Ly thuyet
          </button>
        </div>
      );
    }

    return (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 sm:p-6">
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span className="text-xs text-zinc-500">Tong {flashcards.length} the</span>
          {lessonDetail?.flashcardCompleted && (
            <span className="text-xs rounded-full px-2.5 py-1 border border-cyan-500/40 bg-cyan-500/15 text-cyan-300">
              Flashcard da hoan thanh
            </span>
          )}
          {isMarkingFlashcardComplete && (
            <span className="text-xs rounded-full px-2.5 py-1 border border-violet-500/40 bg-violet-500/15 text-violet-300 inline-flex items-center gap-1.5">
              <Loader2 size={12} className="animate-spin" />Dang ghi nhan
            </span>
          )}
        </div>

        <FlashCardDeck
          cards={flashcards}
          onComplete={(known, total) => {
            void handleFlashcardComplete(known, total);
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

  return (
    <div className="flex h-full">
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 overflow-y-auto">
          <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-3 bg-zinc-950/90 backdrop-blur-sm border-b border-zinc-800">
            <div className="text-xs text-zinc-500">
              <span className="text-violet-400">Learning Workspace</span>
              <span className="mx-1">›</span>
              <span>{lessonDetail?.title ?? 'Dang tai...'}</span>
            </div>
            <button
              onClick={() => setShowChat(!showChat)}
              className={`p-2 rounded-lg transition-colors ${showChat ? 'bg-violet-500/20 text-violet-400 border border-violet-500/30' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'}`}
              title="AI Tutor"
            >
              <MessageSquare size={16} />
            </button>
          </div>

          <div className="max-w-3xl mx-auto px-6 py-8 space-y-8">
            {/* Lesson title */}
            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
              <h1 className="text-3xl text-white" style={{ fontWeight: 700 }}>
                {lessonDetail?.title ?? 'Bai hoc'}
              </h1>
              <p className="text-zinc-500 text-sm mt-1">
                {lessonDetail
                  ? 'Tai lieu dang duoc hoc theo che do NotebookLM Mini.'
                  : 'Dang tai thong tin bai hoc...'}
              </p>
            </motion.div>

            {loadError && (
              <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3">
                <p className="text-sm text-red-300">{loadError}</p>
                <button
                  onClick={() => lessonId && void loadLesson(lessonId)}
                  className="mt-3 inline-flex items-center gap-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 px-3 py-2 text-xs text-zinc-100"
                >
                  <Loader2 size={12} />Thu tai lai
                </button>
              </div>
            )}

              {!loadError && lessonDetail && (
                <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-1.5 sm:p-2 grid grid-cols-3 gap-1.5">
                  <button
                    onClick={() => setLearningTab('theory')}
                    className={`rounded-xl px-3 py-2.5 text-sm flex items-center justify-center gap-2 transition-colors ${activeTab === 'theory' ? 'bg-violet-600 text-white' : 'text-zinc-300 hover:bg-zinc-800'}`}
                    style={{ fontWeight: 600 }}
                  >
                    <BookOpen size={15} />Ly thuyet
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
                    className={`rounded-xl px-3 py-2.5 text-sm flex items-center justify-center gap-2 transition-colors ${activeTab === 'flashcard' ? 'bg-indigo-600 text-white' : lessonDetail.flashcardCompleted ? 'text-cyan-300 hover:bg-cyan-500/10' : 'text-zinc-300 hover:bg-zinc-800'}`}
                    style={{ fontWeight: 600 }}
                  >
                    <CreditCard size={15} />Flashcard
                    {lessonDetail.flashcardCompleted && <CheckCircle2 size={14} className="text-cyan-300" />}
                  </button>
                </div>
              )}

              {!loadError && activeTab === 'theory' && renderTheoryPanel()}
              {!loadError && activeTab === 'quiz' && renderQuizPanel()}
              {!loadError && activeTab === 'flashcard' && renderFlashcardPanel()}
          </div>

          {/* Complete */}
          <div className="sticky bottom-0 bg-zinc-950/95 backdrop-blur-sm border-t border-zinc-800 px-6 py-4">
            <div className="max-w-3xl mx-auto flex items-center justify-end gap-4">

              <button
                onClick={handleComplete}
                disabled={isCompleted || isCompleting}
                className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm transition-all ${
                  isCompleted
                    ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 cursor-default'
                    : 'bg-violet-600 hover:bg-violet-500 text-white'
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
            {completeError && (
              <div className="max-w-3xl mx-auto mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
                {completeError}
              </div>
            )}
          </div>
        </div>

        {/* AI Chat */}
        <AnimatePresence>
          {showChat && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 360, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="flex-shrink-0 border-l border-zinc-800 p-4 overflow-hidden"
            >
              <ChatTutor />
            </motion.div>
          )}
        </AnimatePresence>
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
              <h3 className="text-xl text-white" style={{ fontWeight: 700 }}>Hoan thanh bai hoc roi, lam quiz tiep nhe?</h3>
              <p className="text-sm text-zinc-400 mt-2">
                Vuot quiz de nhan them EXP va bat icon Quiz Passed cho bai hoc nay.
              </p>

              <div className="mt-6 grid grid-cols-2 gap-3">
                <button
                  onClick={() => setShowCompletionModal(false)}
                  className="rounded-xl px-4 py-2.5 text-sm bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
                  style={{ fontWeight: 600 }}
                >
                  De sau
                </button>
                <button
                  onClick={() => {
                    setShowCompletionModal(false);
                    setLearningTab('quiz');
                  }}
                  className="rounded-xl px-4 py-2.5 text-sm bg-cyan-600 hover:bg-cyan-500 text-white"
                  style={{ fontWeight: 600 }}
                >
                  Lam ngay
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
