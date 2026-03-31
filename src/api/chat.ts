import axios from 'axios';

import { apiClient } from './client';
import { createAuthHeaders } from './client';
import { Message } from '../app/lib/types';
import { ChatHistoryMessageDTO, ChatRequestDTO, ChatResponseDTO } from './dto';

export interface PersistedChatMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

function mapHistoryMessage(dto: ChatHistoryMessageDTO): PersistedChatMessage {
  return {
    id: dto.id,
    role: dto.role,
    content: dto.content,
    createdAt: dto.created_at,
  };
}

function normalizeChatError(error: unknown): Error {
  if (!axios.isAxiosError(error)) {
    if (error instanceof Error) return error;
    return new Error('Khong the ket noi tro ly AI luc nay. Vui long thu lai.');
  }

  const hasResponse = Boolean(error.response);
  const code = error.response?.data?.detail?.code as string | undefined;
  const message = error.response?.data?.message as string | undefined;

  if (!hasResponse) {
    return new Error('Loi mang khi ket noi AI. Vui long kiem tra mang va thu lai.');
  }

  if (code === 'LLM_AUTH_FAILED' || code === 'LLM_API_KEY_MISSING') {
    return new Error('AI API key khong hop le hoac da het han. Vui long cap nhat cau hinh backend.');
  }

  if (code === 'LLM_TIMEOUT' || code === 'LLM_NETWORK_ERROR' || code === 'LLM_SERVICE_ERROR') {
    return new Error('Dich vu AI tam thoi khong san sang. Vui long thu lai sau it phut.');
  }

  if (typeof message === 'string' && message.trim()) {
    return new Error(message);
  }

  return new Error('Khong the ket noi tro ly AI luc nay. Vui long thu lai.');
}

export async function getChatHistory(): Promise<PersistedChatMessage[]> {
  try {
    const response = await apiClient.get<ChatHistoryMessageDTO[]>('/chat/history', {
      headers: {
        ...createAuthHeaders(),
      },
    });

    return (response.data ?? []).map(mapHistoryMessage);
  } catch (error) {
    throw normalizeChatError(error);
  }
}

export async function sendChatMessage(content: string): Promise<string> {
  const trimmedContent = content.trim();
  if (!trimmedContent) {
    throw new Error('Noi dung tin nhan khong duoc de trong.');
  }

  const payload: ChatRequestDTO = {
    messages: [
      {
        role: 'user',
        content: trimmedContent,
      },
    ],
  };

  try {
    const response = await apiClient.post<ChatResponseDTO>('/chat', payload, {
      headers: {
        ...createAuthHeaders(),
      },
    });

    return response.data.reply;
  } catch (error) {
    throw normalizeChatError(error);
  }
}

export async function sendChatMessages(messages: ChatRequestDTO['messages']): Promise<string> {
  const lastUserMessage = [...messages].reverse().find(item => item.role === 'user' && item.content.trim());
  if (!lastUserMessage) {
    throw new Error('At least one user message is required.');
  }

  return sendChatMessage(lastUserMessage.content);
}

export async function getSocraticResponse(message: string, history: Message[]): Promise<string> {
  void history;
  return sendChatMessage(message);
}
