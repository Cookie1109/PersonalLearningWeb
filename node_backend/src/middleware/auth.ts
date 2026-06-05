import { Request, Response, NextFunction } from 'express';
import axios from 'axios';
import { config } from '../config';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: number;
    email: string;
    displayName: string;
  };
}

export const authMiddleware = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      message: 'Access token is required',
      detail: { code: 'AUTH_TOKEN_REQUIRED' }
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    // Call FastAPI auth/me endpoint to verify token and retrieve user details
    const response = await axios.get(`${config.fastapiUrl}/api/auth/me`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    const userData = response.data;
    req.user = {
      id: userData.id,
      email: userData.email,
      displayName: userData.display_name || userData.displayName || ''
    };

    next();
  } catch (error: any) {
    const status = error.response?.status || 401;
    const msg = error.response?.data?.message || 'Unauthorized';
    const detail = error.response?.data?.detail || { code: 'INVALID_TOKEN' };

    return res.status(status).json({
      message: msg,
      detail: detail
    });
  }
};
