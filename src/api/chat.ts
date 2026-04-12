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
    return new Error('Không thể kết nối trợ lý AI lúc này. Vui lòng thử lại.');
  }

  const hasResponse = Boolean(error.response);
  const code = error.response?.data?.detail?.code as string | undefined;
  const message = error.response?.data?.message as string | undefined;

  if (!hasResponse) {
    return new Error('Lỗi mạng khi kết nối AI. Vui lòng kiểm tra mạng và thử lại.');
  }

  if (code === 'LLM_AUTH_FAILED' || code === 'LLM_API_KEY_MISSING') {
    return new Error('AI API key không hợp lệ hoặc đã hết hạn. Vui lòng cập nhật cấu hình backend.');
  }

  if (code === 'LLM_TIMEOUT' || code === 'LLM_NETWORK_ERROR' || code === 'LLM_SERVICE_ERROR') {
    return new Error('Dịch vụ AI tạm thời không sẵn sàng. Vui lòng thử lại sau ít phút.');
  }

  if (typeof message === 'string' && message.trim()) {
    return new Error(message);
  }

  return new Error('Không thể kết nối trợ lý AI lúc này. Vui lòng thử lại.');
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
    throw new Error('Nội dung tin nhắn không được để trống.');
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




