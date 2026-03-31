import { apiClient } from './client';
import { Message } from '../app/lib/types';
import { ChatRequestDTO, ChatResponseDTO } from './dto';
import { createAuthHeaders } from './client';

export async function sendChatMessages(messages: ChatRequestDTO['messages']): Promise<string> {
  const payload: ChatRequestDTO = {
    messages,
  };

  const response = await apiClient.post<ChatResponseDTO>('/chat', payload, {
    headers: {
      ...createAuthHeaders(),
    },
  });

  return response.data.reply;
}

export async function getSocraticResponse(message: string, history: Message[]): Promise<string> {
  const messages = [
    ...history.map(item => ({
      role: item.role,
      content: item.content,
    })),
    {
      role: 'user' as const,
      content: message,
    },
  ];

  return sendChatMessages(messages);
}
