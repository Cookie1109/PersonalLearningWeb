import { apiClient } from './client';
import { ActivityDayDTO, UpdateMyProfileRequestDTO, UserProfileDTO } from './dto';

export async function getMyProfile(): Promise<UserProfileDTO> {
  const response = await apiClient.get<UserProfileDTO>('/auth/me');
  return response.data;
}

export async function fetchMyActivity(): Promise<ActivityDayDTO[]> {
  const response = await apiClient.get<ActivityDayDTO[]>('/auth/activity');
  return response.data ?? [];
}

export async function updateMyProfile(payload: UpdateMyProfileRequestDTO): Promise<UserProfileDTO> {
  const response = await apiClient.patch<UserProfileDTO>('/auth/me', payload);
  return response.data;
}

export async function uploadMyAvatar(file: File): Promise<UserProfileDTO> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await apiClient.post<UserProfileDTO>('/auth/avatar', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });

  return response.data;
}
