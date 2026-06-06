import express from 'express';
import cors from 'cors';
import { config } from './config';
import uploadRouter from './routes/upload';
import { authMiddleware } from './middleware/auth';
import './queue'; // Import queue to start the BullMQ worker process

const app = express();

const corsAllowOrigins = process.env.CORS_ALLOW_ORIGINS
  ? process.env.CORS_ALLOW_ORIGINS.split(',').map(o => o.trim().replace(/\/+$/, ''))
  : [
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'http://localhost:8000',
      'http://127.0.0.1:8000',
      'https://personal-learning-web.vercel.app',
    ];

const corsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    if (!origin) {
      callback(null, true);
      return;
    }
    const cleanOrigin = origin.trim().replace(/\/+$/, '');
    if (corsAllowOrigins.includes(cleanOrigin) || /^https:\/\/.*\.vercel\.app$/.test(cleanOrigin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Internal-Secret', 'X-Request-ID'],
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health Check Route
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'NEXL Upload Service' });
});

// Register Upload & Job routes, protected by JWT Firebase Auth Middleware
app.use('/api/node', authMiddleware, uploadRouter);

const server = app.listen(config.port, () => {
  console.log(`NEXL Node.js backend listening on port ${config.port}`);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});
