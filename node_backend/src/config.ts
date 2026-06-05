import dotenv from 'dotenv';
import path from 'path';

// Load env from backend/.env
dotenv.config({ path: path.resolve(__dirname, '../../backend/.env') });

export const config = {
  port: parseInt(process.env.NODE_PORT || '8002', 10),
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379/0',
  databaseUrl: process.env.DATABASE_URL || 'mysql://root:root@localhost:3306/personal_learning',
  fastapiUrl: process.env.FASTAPI_URL || 'http://localhost:8001',
  firebaseProjectId: process.env.FIREBASE_PROJECT_ID || 'nexl-92622',
  firebaseCredentialsPath: process.env.FIREBASE_CREDENTIALS_PATH || path.resolve(__dirname, '../../nexl-92622-firebase-adminsdk-fbsvc-e79999815c.json'),
  // Shared secret for internal Node.js → FastAPI calls (must match INTERNAL_SERVICE_SECRET in backend/.env)
  internalServiceSecret: process.env.INTERNAL_SERVICE_SECRET || 'nexl-internal-dev-secret-change-in-production',
};
