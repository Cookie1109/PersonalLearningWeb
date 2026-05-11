import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Send } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import useAITutor from '../hooks/useAITutor';

export interface AITutorChatProps {
  documentId: string | number;
  className?: string;
}

export default function AITutorChat({ documentId, className = '' }: AITutorChatProps) {
  const { messages, isTyping, error, sendMessage } = useAITutor(documentId);
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  const lastMessage = useMemo(() => messages[messages.length - 1], [messages]);
  const showTypingIndicator = isTyping && lastMessage?.role === 'ai' && !lastMessage.content;

  const handleSubmit = useCallback(async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isTyping) {
      return;
    }

    const trimmed = input.trim();
    if (!trimmed) {
      return;
    }

    setInput('');
    await sendMessage(trimmed, documentId);
  }, [documentId, input, isTyping, sendMessage]);

  return (
    <div className={`flex h-full min-h-[520px] flex-col rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-white ${className}`.trim()}>
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {messages.length === 0 && !isTyping && (
          <div className="h-full flex items-center justify-center text-center">
            <div>
              <p className="text-sm text-slate-700 dark:text-zinc-200" style={{ fontWeight: 600 }}>
                Hỏi đáp trực tiếp với tài liệu
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-zinc-500">
                Đặt câu hỏi và AI sẽ trả lời theo nội dung bạn đang học.
              </p>
            </div>
          </div>
        )}

        {messages.map(message => (
          <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] rounded-2xl border px-4 py-2.5 text-sm leading-relaxed ${
                message.role === 'user'
                  ? 'bg-cyan-600 text-white border-cyan-500/40'
                  : 'bg-slate-100 text-slate-800 border-slate-200 dark:bg-zinc-800 dark:text-zinc-100 dark:border-zinc-700'
              }`}
            >
              {message.role === 'ai' ? (
                <div className="prose prose-sm max-w-none break-words text-slate-800 dark:text-zinc-100 dark:prose-invert prose-p:my-2 prose-strong:text-slate-900 dark:prose-strong:text-zinc-50 prose-ul:my-2 prose-ul:pl-5 prose-ol:my-2 prose-ol:pl-5 prose-li:my-1">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      table: ({ node, ...props }) => (
                        <div className="overflow-x-auto my-4 rounded-lg border border-slate-200 dark:border-zinc-700">
                          <table className="min-w-full text-sm divide-y divide-slate-200 dark:divide-zinc-700" {...props} />
                        </div>
                      ),
                      thead: ({ node, ...props }) => (
                        <thead className="bg-slate-50 dark:bg-zinc-800/50" {...props} />
                      ),
                      th: ({ node, ...props }) => (
                        <th className="px-4 py-3 text-left font-semibold text-slate-900 dark:text-zinc-100" {...props} />
                      ),
                      td: ({ node, ...props }) => (
                        <td className="px-4 py-3 border-t border-slate-200 dark:border-zinc-700" {...props} />
                      ),
                      pre: ({ node, children, ...props }) => {
                        const child = Array.isArray(children) ? children[0] : children;
                        const childClassName = child?.props?.className || '';
                        const match = /language-(\w+)/.exec(childClassName);

                        return (
                          <div className="relative my-4 overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
                            {match ? (
                              <div className="bg-zinc-100 dark:bg-zinc-800/80 px-3 py-1 text-xs font-mono text-zinc-500 uppercase">
                                {match[1]}
                              </div>
                            ) : null}
                            <pre
                              className="bg-zinc-50 dark:bg-zinc-950 p-4 overflow-x-auto text-sm leading-relaxed text-zinc-800 dark:text-zinc-200"
                              {...props}
                            >
                              {children}
                            </pre>
                          </div>
                        );
                      },
                      code: ({ node, className, children, ...props }) => {
                        const match = /language-(\w+)/.exec(className || '');
                        if (!match) {
                          return (
                            <code
                              className="inline bg-cyan-100 dark:bg-cyan-900/30 text-cyan-800 dark:text-cyan-300 px-1.5 py-0.5 rounded text-sm font-mono"
                              {...props}
                            >
                              {children}
                            </code>
                          );
                        }

                        return (
                          <code className={`font-mono ${className || ''}`} {...props}>
                            {children}
                          </code>
                        );
                      },
                    }}
                  >
                    {message.content}
                  </ReactMarkdown>
                </div>
              ) : (
                <span className="whitespace-pre-wrap">{message.content}</span>
              )}
            </div>
          </div>
        ))}

        {showTypingIndicator && (
          <div className="flex justify-start">
            <div className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-100 px-4 py-2.5 text-sm text-slate-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
              <Loader2 size={14} className="animate-spin" />AI đang suy nghĩ...
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="border-t border-slate-200 bg-white/95 px-5 py-4 backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-900/95">
        {error && (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex items-center gap-2">
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            disabled={isTyping}
            placeholder="Đặt câu hỏi về tài liệu này..."
            className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 outline-none focus:border-cyan-400/70 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-500"
          />
          <button
            type="submit"
            disabled={isTyping || !input.trim()}
            className="inline-flex items-center gap-2 rounded-xl bg-cyan-600 px-4 py-2.5 text-sm text-white hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
            style={{ fontWeight: 600 }}
          >
            <Send size={14} />Gửi
          </button>
        </form>
      </div>
    </div>
  );
}
