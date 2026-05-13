import { useCallback, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';

import { firebaseAuth } from '../../api/firebase';

export interface Message {
  id: string;
  role: 'user' | 'ai';
  content: string;
  createdAt?: string; // ISO string, only present for history messages
  isHistory?: boolean;
}

interface TutorHistoryMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

export interface UseAITutorReturn {
  messages: Message[];
  isTyping: boolean;
  isLoadingHistory: boolean;
  historyLoadError: string | null;
  error: string | null;
  sendMessage: (question: string, documentId: string | number) => Promise<void>;
  clearHistory: (documentId: string | number) => Promise<void>;
  retryLoadHistory: (documentId: string | number) => Promise<void>;
}

function resolveApiBaseUrl(): string {
  const configuredBaseUrl = (
    import.meta.env.VITE_API_URL
    || import.meta.env.VITE_API_BASE_URL
    || '/api'
  ).trim();

  if (!configuredBaseUrl) {
    return '/api';
  }

  return configuredBaseUrl.replace(/\/+$/, '');
}

let authStateResolved = false;
let authStateResolutionPromise: Promise<void> | null = null;

function waitForAuthStateResolution(): Promise<void> {
  if (authStateResolved || firebaseAuth.currentUser) {
    authStateResolved = true;
    return Promise.resolve();
  }

  if (!authStateResolutionPromise) {
    authStateResolutionPromise = new Promise(resolve => {
      const unsubscribe = onAuthStateChanged(
        firebaseAuth,
        () => {
          authStateResolved = true;
          unsubscribe();
          resolve();
        },
        () => {
          authStateResolved = true;
          unsubscribe();
          resolve();
        }
      );
    });
  }

  return authStateResolutionPromise;
}

function createMessageId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function extractSseData(event: string): string {
  const lines = event.split('\n');
  const dataLines = lines
    .filter(line => line.startsWith('data:'))
    .map(line => line.replace(/^data:\s?/, ''));

  return dataLines.join('\n');
}

export default function useAITutor(documentId: string | number = ''): UseAITutorReturn {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [historyLoadError, setHistoryLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const getAuthToken = useCallback(async () => {
    await waitForAuthStateResolution();
    const user = firebaseAuth.currentUser;
    if (!user) {
      throw new Error('You must be signed in to use AI Tutor.');
    }

    let token: string | null = null;
    try {
      token = await user.getIdToken();
    } catch {
      token = await user.getIdToken(true);
    }

    if (!token) {
      throw new Error('Unable to retrieve auth token.');
    }

    return token;
  }, []);

  const loadHistory = useCallback(async (docId: string | number) => {
    const normalizedDocumentId = String(docId ?? '').trim();
    if (!normalizedDocumentId) {
      setMessages([]);
      return;
    }

    setIsLoadingHistory(true);
    setHistoryLoadError(null);

    try {
      const token = await getAuthToken();
      const response = await fetch(
        `${resolveApiBaseUrl()}/documents/${normalizedDocumentId}/tutor/history`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!response.ok) {
        if (response.status === 404) {
          // Document not found – treat as empty history, not an error
          setMessages([]);
          return;
        }
        setHistoryLoadError('Không thể tải lịch sử hội thoại. Vui lòng thử lại.');
        return;
      }

      const payload = (await response.json()) as TutorHistoryMessage[];
      const historyMessages: Message[] = payload.map(item => ({
        id: `history-${item.id}`,
        role: item.role === 'assistant' ? 'ai' : 'user',
        content: item.content,
        createdAt: item.created_at,
        isHistory: true,
      }));

      setMessages(historyMessages);
      setHistoryLoadError(null);
    } catch {
      setHistoryLoadError('Không thể tải lịch sử hội thoại. Vui lòng thử lại.');
    } finally {
      setIsLoadingHistory(false);
    }
  }, [getAuthToken]);

  useEffect(() => {
    setMessages([]);
    setHistoryLoadError(null);
    loadHistory(documentId);
  }, [documentId, loadHistory]);

  const clearHistory = useCallback(async (docId: string | number) => {
    const normalizedDocumentId = String(docId ?? '').trim();
    if (!normalizedDocumentId) return;

    try {
      const token = await getAuthToken();
      const response = await fetch(
        `${resolveApiBaseUrl()}/documents/${normalizedDocumentId}/tutor/history`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      if (!response.ok) {
        throw new Error('Failed to clear history');
      }
      setMessages([]);
      setError(null);
    } catch {
      setError('Không thể xóa lịch sử hội thoại. Vui lòng thử lại.');
    }
  }, [getAuthToken]);

  const retryLoadHistory = useCallback(async (docId: string | number) => {
    await loadHistory(docId);
  }, [loadHistory]);

  const sendMessage = useCallback(async (question: string, docId: string | number) => {
    const normalizedQuestion = question.trim();
    if (!normalizedQuestion) {
      setError('Please enter a question.');
      return;
    }

    const normalizedDocumentId = String(docId ?? '').trim();
    if (!normalizedDocumentId) {
      setError('Document id is required.');
      return;
    }

    setError(null);

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const userMessage: Message = {
      id: createMessageId(),
      role: 'user',
      content: normalizedQuestion,
      isHistory: false,
    };
    const aiMessageId = createMessageId();
    const aiMessage: Message = {
      id: aiMessageId,
      role: 'ai',
      content: '',
      isHistory: false,
    };

    setMessages(prev => [...prev, userMessage, aiMessage]);
    setIsTyping(true);

    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const token = await getAuthToken();

      const response = await fetch(
        `${resolveApiBaseUrl()}/documents/${normalizedDocumentId}/tutor/stream`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            document_id: normalizedDocumentId,
            question: normalizedQuestion,
          }),
          signal: controller.signal,
        }
      );

      if (!response.ok) {
        let errorMessage = `Request failed with status ${response.status}`;
        try {
          const payload = await response.json();
          if (payload?.message) {
            errorMessage = payload.message;
          }
        } catch {
          const text = await response.text();
          if (text) {
            errorMessage = text;
          }
        }
        throw new Error(errorMessage);
      }

      if (!response.body) {
        throw new Error('Streaming is not supported by the browser.');
      }

      reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        // Buffer SSE data because chunks can end mid-event. Split on "\n\n" and
        // keep the last partial event in the buffer for the next chunk.
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';

        for (const event of events) {
          const chunkText = extractSseData(event);
          if (!chunkText) {
            continue;
          }

          setMessages(prev => prev.map(message => (
            message.id === aiMessageId
              ? { ...message, content: `${message.content}${chunkText}` }
              : message
          )));
        }
      }

      if (buffer.trim()) {
        const tailText = extractSseData(buffer);
        if (tailText) {
          setMessages(prev => prev.map(message => (
            message.id === aiMessageId
              ? { ...message, content: `${message.content}${tailText}` }
              : message
          )));
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      const message = err instanceof Error ? err.message : 'Something went wrong.';
      setError(message);
    } finally {
      if (reader) {
        reader.releaseLock();
      }
      setIsTyping(false);
    }
  }, [getAuthToken]);

  return {
    messages,
    isTyping,
    isLoadingHistory,
    historyLoadError,
    error,
    sendMessage,
    clearHistory,
    retryLoadHistory,
  };
}
