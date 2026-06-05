import { Response, NextFunction } from 'express';
import { config } from '../config';
import { AuthenticatedRequest } from './auth';
import { redis } from '../redis';

interface RateLimitOptions {
  limit: number;
  windowSec: number;
}

// Token bucket rate limiter using a Lua script for atomic read-modify-write.
//
// ARGV[1] = max_tokens   : maximum burst capacity (= options.limit)
// ARGV[2] = refill_rate  : tokens refilled per millisecond
// ARGV[3] = now          : current timestamp in ms (Date.now())
// ARGV[4] = expire_sec   : dynamic TTL for the Redis key (computed from windowSec)
//
// TTL rationale: the bucket always refills to max_tokens within windowSec seconds.
// After that the old state ≡ a freshly-created key, so we only need to keep the key
// alive for max(windowSec * 2, 120) seconds — enough for 2 full refill cycles.
const tokenBucketScript = `
  local key = KEYS[1]
  local max_tokens  = tonumber(ARGV[1])
  local refill_rate = tonumber(ARGV[2])
  local now         = tonumber(ARGV[3])
  local expire_sec  = tonumber(ARGV[4])

  local data = redis.call('HMGET', key, 'tokens', 'last_refill')
  local tokens      = tonumber(data[1])
  local last_refill = tonumber(data[2])

  if not tokens then
    tokens      = max_tokens
    last_refill = now
  else
    local elapsed = now - last_refill
    local refill  = elapsed * refill_rate
    tokens        = math.min(max_tokens, tokens + refill)
    last_refill   = now
  end

  if tokens >= 1 then
    tokens = tokens - 1
    redis.call('HMSET', key, 'tokens', tokens, 'last_refill', last_refill)
    redis.call('EXPIRE', key, expire_sec)
    return {1, math.floor(tokens)}
  else
    -- Even on deny, refresh TTL so the key doesn't expire while the user is still active
    redis.call('EXPIRE', key, expire_sec)
    return {0, math.floor(tokens)}
  end
`;

export const rateLimiter = (options: RateLimitOptions) => {
  const refillRate = options.limit / (options.windowSec * 1000);

  // Dynamic TTL: keep key alive for 2 full refill cycles (min 120 s).
  // Once the bucket has been idle for windowSec seconds it would be full anyway,
  // so there is no value in keeping stale state beyond that.
  const ttlSeconds = Math.max(Math.ceil(options.windowSec * 2), 120);

  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const endpoint = req.baseUrl + req.path;
    const redisKey = `ratelimit:${userId}:${endpoint}`;

    try {
      const now = Date.now();
      const result = await redis.eval(
        tokenBucketScript,
        1,
        redisKey,
        options.limit.toString(),
        refillRate.toString(),
        now.toString(),
        ttlSeconds.toString()          // ARGV[4]: dynamic TTL
      ) as [number, number];

      const [allowed, remainingTokens] = result;

      // Time (in seconds) until the bucket is completely full again
      const secondsUntilFull = remainingTokens < options.limit
        ? Math.ceil((options.limit - remainingTokens) / (options.limit / options.windowSec))
        : 0;

      res.setHeader('X-RateLimit-Limit', options.limit);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, remainingTokens));
      res.setHeader('X-RateLimit-Reset', secondsUntilFull);   // seconds until full refill

      if (allowed === 1) {
        next();
      } else {
        res.status(429).json({
          message: 'Too Many Requests',
          detail: {
            code: 'RATE_LIMIT_EXCEEDED',
            retry_after_seconds: secondsUntilFull,
          },
        });
      }
    } catch (error) {
      console.error('⚠️  Rate limiter FAIL-OPEN — Redis unavailable, request allowed without rate limiting:', error);
      next();
    }
  };
};
