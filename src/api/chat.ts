import { apiClient } from './client';
import { Message } from '../app/lib/types';
import { ChatRequestDTO, ChatResponseDTO } from './dto';

export async function getSocraticResponse(message: string, history: Message[]): Promise<string> {
  const payload: ChatRequestDTO = {
    message,
    history: history.map(item => ({
      id: item.id,
      role: item.role,
      content: item.content,
      timestamp: item.timestamp.toISOString(),
    })),
  };

  const response = await apiClient.post<ChatResponseDTO>('/chat/socratic', payload);
  return response.data.reply;
}
