import { apiClient } from './client';
import { ActivityDayDTO, UserProfileDTO } from './dto';

export async function getMyProfile(): Promise<UserProfileDTO> {
  const response = await apiClient.get<UserProfileDTO>('/auth/me');
  return response.data;
}

export async function fetchMyActivity(): Promise<ActivityDayDTO[]> {
  const response = await apiClient.get<ActivityDayDTO[]>('/auth/activity');
  return response.data ?? [];
}
