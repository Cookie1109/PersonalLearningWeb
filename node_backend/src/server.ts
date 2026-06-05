import express from 'express';
import cors from 'cors';
import { config } from './config';
import uploadRouter from './routes/upload';
import { authMiddleware } from './middleware/auth';
import './queue'; // Import queue to start the BullMQ worker process

const app = express();

app.use(cors());
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
