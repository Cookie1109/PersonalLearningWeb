import { apiClient, clearClientAuthState, getAccessToken, setAccessToken } from './client';
import {
  GenericStatusDTO,
  LoginRequestDTO,
  LoginResponseDTO,
  LogoutRequestDTO,
  RegisterRequestDTO,
  RegisterResponseDTO,
} from './dto';

export async function login(payload: LoginRequestDTO): Promise<LoginResponseDTO> {
  const response = await apiClient.post<LoginResponseDTO>('/auth/login', payload);
  setAccessToken(response.data.access_token);
  return response.data;
}

export async function register(payload: RegisterRequestDTO): Promise<RegisterResponseDTO> {
  const response = await apiClient.post<RegisterResponseDTO>('/auth/register', payload);
  return response.data;
}

export async function logout(payload: LogoutRequestDTO = { revoke_all_devices: false }): Promise<GenericStatusDTO> {
  const token = getAccessToken();
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined;

  try {
    const response = await apiClient.post<GenericStatusDTO>('/auth/logout', payload, { headers });
    return response.data;
  } catch {
    return { status: 'ok', message: 'Logged out locally' };
  } finally {
    clearClientAuthState();
  }
}
