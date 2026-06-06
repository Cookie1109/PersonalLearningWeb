import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Clock, Loader2, MessageSquare, RotateCcw, Send, Trash2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import useAITutor, { type Message } from '../hooks/useAITutor';

export interface AITutorChatProps {
  documentId: string | number;
  className?: string;
}

function formatMessageTime(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffDays === 0) {
      return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    }
    if (diffDays === 1) return `Hôm qua ${d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`;
    if (diffDays < 7) return `${diffDays} ngày trước`;
    return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return '';
  }
}

function getHistoryGroupDate(messages: Message[]): string | null {
  const first = messages.find(m => m.isHistory && m.createdAt);
  if (!first?.createdAt) return null;
  try {
    return new Date(first.createdAt).toLocaleDateString('vi-VN', {
      day: '2-digit', month: '2-digit', year: 'numeric',
    });
  } catch {
    return null;
  }
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-2xl border px-4 py-2.5 text-sm leading-relaxed ${message.isHistory ? 'opacity-75' : 'opacity-100'
          } ${isUser
            ? 'bg-cyan-600 text-white border-cyan-500/40'
            : 'bg-zinc-800 text-zinc-100 border-zinc-700'
          }`}
      >
        {message.role === 'ai' ? (
          <div className="prose prose-sm max-w-none break-words text-zinc-100 dark:prose-invert prose-p:my-2 prose-strong:text-zinc-50 prose-ul:my-2 prose-ul:pl-5 prose-ol:my-2 prose-ol:pl-5 prose-li:my-1">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                table: ({ node, ...props }) => (
                  <div className="overflow-x-auto my-4 rounded-lg border border-zinc-700">
                    <table className="min-w-full text-sm divide-y divide-zinc-700" {...props} />
                  </div>
                ),
                thead: ({ node, ...props }) => (
                  <thead className="bg-zinc-800/50" {...props} />
                ),
                th: ({ node, ...props }) => (
                  <th className="px-4 py-3 text-left font-semibold text-zinc-100" {...props} />
                ),
                td: ({ node, ...props }) => (
                  <td className="px-4 py-3 border-t border-zinc-700" {...props} />
                ),
                pre: ({ node, children, ...props }) => {
                  const childArr = Array.isArray(children) ? children : [children];
                  const childClassName: string = childArr
                    .map((c) => (c && typeof c === 'object' && 'props' in c ? (c as { props?: { className?: string } }).props?.className ?? '' : ''))
                    .join('');
                  const match = /language-(\w+)/.exec(childClassName);
                  return (
                    <div className="relative my-4 overflow-hidden rounded-xl border border-zinc-700">
                      {match && (
                        <div className="bg-zinc-800/80 px-3 py-1 text-xs font-mono text-zinc-500 uppercase">
                          {match[1]}
                        </div>
                      )}
                      <pre className="bg-zinc-950 p-4 overflow-x-auto text-sm leading-relaxed text-zinc-200" {...props}>
                        {children}
                      </pre>
                    </div>
                  );
                },
                code: ({ node, className, children, ...props }) => {
                  const match = /language-(\w+)/.exec(className || '');
                  if (!match) {
                    return (
                      <code className="inline bg-cyan-900/30 text-cyan-300 px-1.5 py-0.5 rounded text-sm font-mono" {...props}>
                        {children}
                      </code>
                    );
                  }
                  return <code className={`font-mono ${className || ''}`} {...props}>{children}</code>;
                },
              }}
            >
              {message.content}
            </ReactMarkdown>
          </div>
        ) : (
          <span className="whitespace-pre-wrap">{message.content}</span>
        )}

        {/* Timestamp only for history messages */}
        {message.isHistory && message.createdAt && (
          <div className={`mt-1.5 text-[10px] flex items-center gap-1 ${isUser ? 'justify-end text-cyan-200/50' : 'text-zinc-600'
            }`}>
            <Clock size={9} />
            {formatMessageTime(message.createdAt)}
          </div>
        )}
      </div>
    </div>
  );
}

export default function AITutorChat({ documentId, className = '' }: AITutorChatProps) {
  const {
    messages,
    isTyping,
    isLoadingHistory,
    historyLoadError,
    error,
    sendMessage,
    clearHistory,
    retryLoadHistory,
  } = useAITutor(documentId);

  const [input, setInput] = useState('');
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  const lastMessage = useMemo(() => messages[messages.length - 1], [messages]);
  const showTypingIndicator = isTyping && lastMessage?.role === 'ai' && !lastMessage.content;

  const hasHistory = useMemo(() => messages.some(m => m.isHistory), [messages]);
  const historyDate = useMemo(() => getHistoryGroupDate(messages), [messages]);

  // Find the index of the first NEW (non-history) message to insert "current session" separator
  const firstNewMessageIndex = useMemo(() => {
    return messages.findIndex(m => !m.isHistory);
  }, [messages]);

  const handleSubmit = useCallback(async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isTyping) return;
    const trimmed = input.trim();
    if (!trimmed) return;
    setInput('');
    await sendMessage(trimmed, documentId);
  }, [documentId, input, isTyping, sendMessage]);

  const handleClearHistory = useCallback(async () => {
    setIsClearing(true);
    try {
      await clearHistory(documentId);
    } finally {
      setIsClearing(false);
      setShowClearConfirm(false);
    }
  }, [clearHistory, documentId]);

  return (
    <div className={`flex flex-col rounded-2xl border border-zinc-800 bg-zinc-900 text-white overflow-hidden ${className}`.trim()}>

      {/* ── Header ─────────────────────────────────── */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center">
            <MessageSquare size={14} className="text-emerald-400" />
          </div>
          <span className="text-sm font-semibold">Hỏi đáp AI</span>
          {hasHistory && !isLoadingHistory && (
            <span className="text-xs px-2 py-0.5 rounded-full border border-zinc-700 bg-zinc-800 text-zinc-400">
              Có lịch sử
            </span>
          )}
        </div>

        {hasHistory && !isLoadingHistory && (
          <button
            onClick={() => setShowClearConfirm(true)}
            disabled={isTyping || isClearing}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-zinc-500 hover:text-red-400 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 transition-colors disabled:opacity-40"
          >
            <Trash2 size={13} />
            Xóa lịch sử
          </button>
        )}
      </div>

      {/* ── Clear confirm banner ────────────────────── */}
      {showClearConfirm && (
        <div className="mx-4 mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 flex items-center justify-between gap-3 shrink-0">
          <p className="text-sm text-red-300">Xóa toàn bộ lịch sử hội thoại này?</p>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setShowClearConfirm(false)}
              disabled={isClearing}
              className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors"
            >
              Hủy
            </button>
            <button
              onClick={handleClearHistory}
              disabled={isClearing}
              className="text-xs px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white transition-colors inline-flex items-center gap-1.5 disabled:opacity-60"
            >
              {isClearing ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
              Xóa hết
            </button>
          </div>
        </div>
      )}

      {/* ── Messages area ──────────────────────────── */}
      <div className="flex-1 min-h-[420px] max-h-[600px] overflow-y-auto px-5 py-4 space-y-4">

        {/* Loading history */}
        {isLoadingHistory && (
          <div className="flex items-center justify-center gap-2 py-12 text-zinc-500">
            <Loader2 size={18} className="animate-spin text-emerald-400" />
            <span className="text-sm">Đang tải lịch sử hội thoại...</span>
          </div>
        )}

        {/* History load error */}
        {!isLoadingHistory && historyLoadError && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 flex items-center justify-between gap-3">
            <p className="text-xs text-amber-300">{historyLoadError}</p>
            <button
              onClick={() => retryLoadHistory(documentId)}
              className="flex items-center gap-1.5 text-xs text-amber-300 hover:text-amber-200 shrink-0 transition-colors"
            >
              <RotateCcw size={12} />
              Thử lại
            </button>
          </div>
        )}

        {/* Empty state */}
        {!isLoadingHistory && !historyLoadError && messages.length === 0 && !isTyping && (
          <div className="min-h-[360px] flex items-center justify-center text-center">
            <div>
              <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto mb-3">
                <MessageSquare size={22} className="text-emerald-400" />
              </div>
              <p className="text-sm text-zinc-200 font-semibold">Hỏi đáp trực tiếp với tài liệu</p>
              <p className="mt-1 text-xs text-zinc-500 max-w-xs mx-auto leading-relaxed">
                Đặt câu hỏi và AI sẽ trả lời theo nội dung bạn đang học.
              </p>
            </div>
          </div>
        )}

        {/* History header separator */}
        {!isLoadingHistory && hasHistory && (
          <div className="flex items-center gap-3 py-1">
            <div className="flex-1 h-px bg-zinc-800" />
            <div className="flex items-center gap-1.5 text-xs text-zinc-600 whitespace-nowrap">
              <Clock size={11} />
              {historyDate ? `Lịch sử · ${historyDate}` : 'Lịch sử trước đây'}
            </div>
            <div className="flex-1 h-px bg-zinc-800" />
          </div>
        )}

        {/* Message list with inline "Current session" separator */}
        {!isLoadingHistory && messages.map((message, index) => (
          <div key={message.id}>
            {/* Insert "current session" separator before first new message */}
            {index === firstNewMessageIndex && firstNewMessageIndex > 0 && (
              <div className="flex items-center gap-3 py-2 mb-2">
                <div className="flex-1 h-px bg-zinc-800" />
                <span className="text-xs text-emerald-600/70 whitespace-nowrap">Phiên hiện tại</span>
                <div className="flex-1 h-px bg-zinc-800" />
              </div>
            )}
            <MessageBubble message={message} />
          </div>
        ))}

        {/* Typing indicator */}
        {showTypingIndicator && (
          <div className="flex justify-start">
            <div className="inline-flex items-center gap-2 rounded-2xl border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-sm text-zinc-200">
              <Loader2 size={14} className="animate-spin text-emerald-400" />
              AI đang suy nghĩ...
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ── Input area ─────────────────────────────── */}
      <div className="border-t border-zinc-800 bg-zinc-900/95 px-5 py-4 backdrop-blur-sm shrink-0">
        {error && (
          <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        )}
        <form onSubmit={handleSubmit} className="flex items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={isTyping || isLoadingHistory}
            placeholder={isLoadingHistory ? 'Đang tải lịch sử...' : 'Đặt câu hỏi về tài liệu này...'}
            className="flex-1 rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none focus:border-emerald-500/50 transition-colors disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={isTyping || !input.trim() || isLoadingHistory}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
            style={{ fontWeight: 600 }}
          >
            <Send size={14} />Gửi
          </button>
        </form>
      </div>
    </div>
  );
}
