import React, { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';
import { Bot, Loader2, Send, Sparkles, User } from 'lucide-react';
import { useNavigate } from 'react-router';

import { getChatHistory, sendChatMessage } from '../../api/chat';

type ChatRole = 'user' | 'assistant';
const ROADMAP_SUGGESTION_REGEX = /\[SUGGEST_ROADMAP:\s*([^\]]+)\]/i;

interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  rawContent: string;
  suggestedRoadmapTopic?: string;
}

const WELCOME_MESSAGE: ChatMessage = {
  id: 'assistant-welcome',
  role: 'assistant',
  content:
    '## DocsShare Assistant\n\nXin chao! Minh la **Tro ly hoc tap IT**.\n\nBan co the hoi ve lap trinh, bai tap, hoac xin tu van lo trinh hoc. Minh se tra loi bang Markdown kem code neu can.',
  rawContent:
    '## DocsShare Assistant\n\nXin chao! Minh la **Tro ly hoc tap IT**.\n\nBan co the hoi ve lap trinh, bai tap, hoac xin tu van lo trinh hoc. Minh se tra loi bang Markdown kem code neu can.',
};

function parseAssistantReply(rawContent: string): Pick<ChatMessage, 'content' | 'rawContent' | 'suggestedRoadmapTopic'> {
  const topic = rawContent.match(ROADMAP_SUGGESTION_REGEX)?.[1]?.trim();
  const cleanedContent = rawContent.replace(ROADMAP_SUGGESTION_REGEX, '').trim();
  const normalizedContent = normalizeAssistantText(cleanedContent || rawContent);

  return {
    content: normalizedContent,
    rawContent,
    suggestedRoadmapTopic: topic || undefined,
  };
}

function normalizeAssistantText(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) return trimmed;
  if (trimmed.endsWith('```')) return trimmed;
  if (/[.!?…:;)]$/.test(trimmed)) return trimmed;
  return `${trimmed}.`;
}

function TypingIndicator() {
  return (
    <div className="flex items-end gap-3">
      <div className="w-8 h-8 rounded-full bg-violet-600/20 border border-violet-500/40 text-violet-300 flex items-center justify-center">
        <Bot size={15} />
      </div>
      <div className="rounded-2xl rounded-bl-sm bg-zinc-900 border border-zinc-800 px-4 py-3 flex items-center gap-1.5">
        {[0, 1, 2].map(dot => (
          <span
            key={dot}
            className="w-1.5 h-1.5 rounded-full bg-violet-300 animate-pulse"
            style={{ animationDelay: `${dot * 0.15}s` }}
          />
        ))}
      </div>
    </div>
  );
}

export default function ChatPage() {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME_MESSAGE]);
  const [input, setInput] = useState('');
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const canSend = useMemo(() => input.trim().length > 0 && !isLoading && !isBootstrapping, [input, isLoading, isBootstrapping]);

  const latestAssistantSuggestion = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.role === 'assistant') {
        return message.suggestedRoadmapTopic ?? null;
      }
    }

    return null;
  }, [messages]);

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      if (listRef.current) {
        listRef.current.scrollTop = listRef.current.scrollHeight;
      }
    });
  };

  useEffect(() => {
    let isMounted = true;

    const loadHistory = async () => {
      setIsBootstrapping(true);
      setError(null);

      try {
        const history = await getChatHistory();
        if (!isMounted) return;

        if (history.length === 0) {
          setMessages([WELCOME_MESSAGE]);
        } else {
          setMessages(
            history.map(item => {
              if (item.role === 'assistant') {
                const parsed = parseAssistantReply(item.content);
                return {
                  id: `assistant-${item.id}`,
                  role: 'assistant',
                  content: parsed.content,
                  rawContent: parsed.rawContent,
                  suggestedRoadmapTopic: parsed.suggestedRoadmapTopic,
                };
              }

              return {
                id: `user-${item.id}`,
                role: 'user',
                content: item.content,
                rawContent: item.content,
              };
            })
          );
        }
      } catch (err) {
        if (!isMounted) return;
        setMessages([WELCOME_MESSAGE]);
        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError('Khong the tai lich su chat. Vui long thu lai.');
        }
      } finally {
        if (isMounted) {
          setIsBootstrapping(false);
          scrollToBottom();
        }
      }
    };

    void loadHistory();

    return () => {
      isMounted = false;
    };
  }, []);

  const onSend = async (event?: FormEvent) => {
    event?.preventDefault();
    const content = input.trim();
    if (!content || isLoading) return;

    setError(null);
    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content,
      rawContent: content,
    };

    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput('');
    setIsLoading(true);
    scrollToBottom();

    try {
      const reply = await sendChatMessage(content);
      const parsedReply = parseAssistantReply(reply);

      setMessages(prev => [
        ...prev,
        {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: parsedReply.content,
          rawContent: parsedReply.rawContent,
          suggestedRoadmapTopic: parsedReply.suggestedRoadmapTopic,
        },
      ]);
      scrollToBottom();
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Khong the ket noi tro ly AI luc nay. Vui long thu lai.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void onSend();
    }
  };

  return (
    <div className="h-full min-h-[calc(100vh-64px)] flex flex-col bg-zinc-950 text-zinc-100">
      <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 py-5 flex-1 flex flex-col">
        <header className="mb-4">
          <h1 className="text-xl sm:text-2xl" style={{ fontWeight: 700 }}>DocsShare Assistant</h1>
          <p className="text-sm text-zinc-500 mt-1">Tro ly AI tu van hoc IT, ho tro giai bai tap va giai thich code.</p>
        </header>

        <div className="flex-1 min-h-0 rounded-2xl border border-zinc-800 bg-zinc-900/60 overflow-hidden flex flex-col">
          <div ref={listRef} className="flex-1 overflow-y-auto px-3 sm:px-5 py-4 space-y-4">
            {messages.map(message => {
              const isUser = message.role === 'user';
              return (
                <div key={message.id} className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
                  {!isUser && (
                    <div className="w-8 h-8 rounded-full bg-violet-600/20 border border-violet-500/40 text-violet-300 flex items-center justify-center flex-shrink-0">
                      <Bot size={15} />
                    </div>
                  )}

                  <div className={`max-w-[85%] sm:max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${isUser ? 'bg-violet-600 text-white rounded-br-sm' : 'bg-zinc-900 border border-zinc-800 text-zinc-100 rounded-bl-sm'}`}>
                    {isUser ? (
                      <p className="whitespace-pre-wrap">{message.content}</p>
                    ) : (
                      <div className="prose prose-invert prose-sm max-w-none break-words prose-pre:bg-zinc-950 prose-pre:border prose-pre:border-zinc-800 prose-code:text-zinc-100">
                        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                          {message.content}
                        </ReactMarkdown>
                      </div>
                    )}
                  </div>

                  {isUser && (
                    <div className="w-8 h-8 rounded-full bg-zinc-700 border border-zinc-600 text-zinc-200 flex items-center justify-center flex-shrink-0">
                      <User size={15} />
                    </div>
                  )}
                </div>
              );
            })}

            {isLoading && <TypingIndicator />}
          </div>

          {latestAssistantSuggestion && (
            <div className="mx-3 sm:mx-5 mb-3 rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-3">
              <p className="text-sm text-amber-100" style={{ fontWeight: 600 }}>
                Ban co muon AI tao lo trinh hoc {latestAssistantSuggestion} ngay khong?
              </p>
              <button
                type="button"
                onClick={() => navigate(`/roadmap?goal=${encodeURIComponent(latestAssistantSuggestion)}`)}
                className="mt-2 inline-flex items-center gap-2 rounded-lg bg-amber-400 text-zinc-950 px-3 py-2 text-sm hover:bg-amber-300 transition-colors"
                style={{ fontWeight: 700 }}
              >
                <Sparkles size={14} />
                Tao lo trinh ngay
              </button>
            </div>
          )}

          <form onSubmit={onSend} className="border-t border-zinc-800 px-3 sm:px-5 py-3">
            {error && (
              <div className="mb-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {error}
              </div>
            )}
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={event => setInput(event.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Hoi DocsShare Assistant..."
                rows={1}
                className="flex-1 resize-none rounded-xl bg-zinc-800 border border-zinc-700 px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-violet-500/60"
              />
              <button
                type="submit"
                disabled={!canSend}
                className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label="Gui tin nhan"
              >
                {isLoading ? <Loader2 size={16} className="animate-spin text-white" /> : <Send size={16} className="text-white" />}
              </button>
            </div>
            <p className="text-[11px] text-zinc-500 mt-2">
              {isBootstrapping ? 'Dang tai lich su chat...' : 'Nhan Enter de gui, Shift+Enter de xuong dong.'}
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
