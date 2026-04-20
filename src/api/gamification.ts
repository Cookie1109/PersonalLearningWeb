import { apiClient } from './client';
import {
  DailyQuestListResponseDTO,
  GamificationHeatmapResponseDTO,
  GamificationProfileDTO,
  GamificationTrackRequestDTO,
  GamificationTrackResponseDTO,
} from './dto';

export async function getGamificationProfile(): Promise<GamificationProfileDTO> {
  const response = await apiClient.get<GamificationProfileDTO>('/gamification/profile');
  return response.data;
}

export async function getDailyQuests(): Promise<DailyQuestListResponseDTO> {
  const response = await apiClient.get<DailyQuestListResponseDTO>('/gamification/quests');
  return response.data;
}

export async function getHeatmapData(year: number): Promise<GamificationHeatmapResponseDTO> {
  const response = await apiClient.get<GamificationHeatmapResponseDTO>('/gamification/heatmap', {
    params: { year },
  });
  return response.data;
}

export async function trackGamification(payload: GamificationTrackRequestDTO): Promise<GamificationTrackResponseDTO> {
  const response = await apiClient.post<GamificationTrackResponseDTO>('/gamification/track', payload);
  return response.data;
}
