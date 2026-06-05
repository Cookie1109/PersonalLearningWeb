import IORedis from 'ioredis';
import { config } from './config';

/**
 * Shared Redis connection for the Node.js backend.
 * Import this instead of creating new IORedis instances per module.
 */
export const redis = new IORedis(config.redisUrl, {
  maxRetriesPerRequest: null,
});

redis.on('error', (err) => {
  console.error('Redis connection error:', err.message);
});

redis.on('connect', () => {
  console.log('Redis connected');
});
