import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Send, Bot, User, Sparkles, RefreshCw, Lightbulb } from 'lucide-react';
import { Message } from '../lib/types';
import { getSocraticResponse } from '../../api/chat';

const DEFAULT_INITIAL_MESSAGE: Message = {
  id: 'init',
  role: 'assistant',
  content: `Xin chào! Tôi là **AI Tutor** của bạn 🧠✨\n\nTôi sẽ không đưa ra đáp án trực tiếp — thay vào đó, tôi sẽ đặt câu hỏi gợi mở để giúp bạn **tự khám phá** và hiểu sâu hơn.\n\nHãy hỏi bất kỳ điều gì về bài học, tôi luôn sẵn sàng! 🚀`,
  timestamp: new Date(),
};

const DEFAULT_QUICK_PROMPTS = [
  'Giải thích cho tôi về DataFrame',
  'Tại sao cần dùng Pandas?',
  'Sự khác biệt giữa .loc và .iloc?',
  'Tôi bị lỗi, giúp tôi debug!',
];

export interface ChatTutorProps {
  initialMessage?: Message;
  quickPrompts?: string[];
  title?: string;
  subtitle?: string;
  inputPlaceholder?: string;
  errorMessage?: string;
  onSendMessage?: (message: string, history: Message[]) => Promise<string>;
}

function MessageBubble({ message }: { message: Message }) {
  const isAI = message.role === 'assistant';

  const formatContent = (text: string) => {
    const parts = text.split(/(\*\*.*?\*\*)/g);
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={i} className="text-violet-300 font-semibold">{part.slice(2, -2)}</strong>;
      }
      return <span key={i}>{part}</span>;
    });
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex gap-3 ${isAI ? '' : 'flex-row-reverse'}`}
    >
      {/* Avatar */}
      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
        isAI ? 'bg-violet-600' : 'bg-zinc-700'
      }`}>
        {isAI ? <Bot size={15} className="text-white" /> : <User size={15} className="text-zinc-300" />}
      </div>

      {/* Bubble */}
      <div className={`max-w-[80%] ${isAI ? '' : 'items-end flex flex-col'}`}>
        <div className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
          isAI
            ? 'bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-tl-sm'
            : 'bg-violet-600 text-white rounded-tr-sm'
        }`}>
          {message.content.split('\n').map((line, i) => (
            <p key={i} className={line === '' ? 'h-2' : ''}>
              {formatContent(line)}
            </p>
          ))}
        </div>
        <p className="text-xs text-zinc-600 mt-1 px-1">
          {message.timestamp.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
    </motion.div>
  );
}

function TypingIndicator() {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex gap-3">
      <div className="w-8 h-8 rounded-full bg-violet-600 flex items-center justify-center flex-shrink-0">
        <Bot size={15} className="text-white" />
      </div>
      <div className="bg-zinc-800 border border-zinc-700 rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-1">
        {[0, 1, 2].map(i => (
          <motion.div
            key={i}
            animate={{ y: [0, -4, 0] }}
            transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.15 }}
            className="w-1.5 h-1.5 rounded-full bg-violet-400"
          />
        ))}
      </div>
    </motion.div>
  );
}

export default function ChatTutor({
  initialMessage = DEFAULT_INITIAL_MESSAGE,
  quickPrompts = DEFAULT_QUICK_PROMPTS,
  title = 'AI Tutor · Socratic Method',
  subtitle = 'Luôn sẵn sàng gợi mở tư duy',
  inputPlaceholder = 'Hỏi AI Tutor bất cứ điều gì...',
  errorMessage = 'Xin lỗi, tôi gặp lỗi kết nối. Hãy thử lại nhé! 🔄',
  onSendMessage = getSocraticResponse,
}: ChatTutorProps) {
  const [messages, setMessages] = useState<Message[]>([initialMessage]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMessages([initialMessage]);
  }, [initialMessage]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const sendMessage = async (text?: string) => {
    const messageText = text || input.trim();
    if (!messageText || isLoading) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: messageText,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      const response = await onSendMessage(messageText, messages);
      const aiMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: response,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, aiMsg]);
    } catch {
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: errorMessage,
        timestamp: new Date(),
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const clearChat = () => {
    setMessages([initialMessage]);
  };

  return (
    <div className="flex flex-col h-full bg-zinc-900 rounded-2xl border border-violet-500/30 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-violet-500/10">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-violet-600 flex items-center justify-center">
            <Sparkles size={14} className="text-white" />
          </div>
          <div>
            <p className="text-sm text-white" style={{ fontWeight: 600 }}>{title}</p>
            <div className="flex items-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <p className="text-xs text-zinc-500">{subtitle}</p>
            </div>
          </div>
        </div>
        <button onClick={clearChat} className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors" title="Xóa lịch sử chat">
          <RefreshCw size={14} />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 scrollbar-thin">
        <AnimatePresence>
          {messages.map(msg => <MessageBubble key={msg.id} message={msg} />)}
        </AnimatePresence>
        {isLoading && <TypingIndicator />}
        <div ref={messagesEndRef} />
      </div>

      {/* Quick prompts */}
      {messages.length <= 1 && (
        <div className="px-4 pb-3">
          <div className="flex items-center gap-1.5 mb-2">
            <Lightbulb size={12} className="text-yellow-400" />
            <p className="text-xs text-zinc-500">Câu hỏi gợi ý:</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {quickPrompts.map(prompt => (
              <button
                key={prompt}
                onClick={() => sendMessage(prompt)}
                className="text-xs px-3 py-1.5 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-400 hover:text-violet-300 hover:border-violet-500/50 transition-all"
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div className="px-4 pb-4">
        <div className="flex gap-2 bg-zinc-800 rounded-xl border border-zinc-700 focus-within:border-violet-500/50 transition-colors p-1">
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
            placeholder={inputPlaceholder}
            className="flex-1 bg-transparent text-sm text-zinc-200 placeholder:text-zinc-600 px-3 py-2 outline-none"
          />
          <button
            onClick={() => sendMessage()}
            disabled={!input.trim() || isLoading}
            className="w-9 h-9 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center transition-colors flex-shrink-0"
          >
            <Send size={15} className="text-white" />
          </button>
        </div>
        <p className="text-xs text-zinc-600 mt-1.5 text-center">
          AI Tutor sẽ gợi mở — không đưa đáp án trực tiếp 🧠
        </p>
      </div>
    </div>
  );
}
