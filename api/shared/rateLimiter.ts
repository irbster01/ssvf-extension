/**
 * Rate limiter with Redis backend for distributed rate limiting across
 * Azure Functions instances. Falls back to in-memory if Redis is not configured.
 *
 * Configure via environment variable:
 *   REDIS_CONNECTION_STRING=your-redis.redis.cache.windows.net:6380,password=xxx,ssl=True,abortConnect=False
 *
 * Or skip Redis config to use the existing in-memory fallback (single-instance only).
 */

// In-memory fallback stores (same as before — works for single-instance)
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 60; // 60 requests per minute

// Redis client (lazy-initialized)
let redisReady = false;
let redisClient: RedisLike | null = null;
let redisInitAttempted = false;

interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { EX?: number }): Promise<unknown>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
  quit(): Promise<unknown>;
}

/**
 * Attempt to connect to Redis. Non-blocking — if it fails, we fall back to in-memory.
 */
async function ensureRedis(): Promise<RedisLike | null> {
  if (redisInitAttempted) return redisClient;
  redisInitAttempted = true;

  const connectionString = process.env.REDIS_CONNECTION_STRING;
  if (!connectionString) {
    console.warn('[RateLimiter] REDIS_CONNECTION_STRING not set — using in-memory rate limiting');
    return null;
  }

  try {
    // Dynamic import so the module is optional
    const redis = await import('redis');
    const client = redis.createClient({ url: connectionString });
    client.on('error', (err: Error) => {
      console.warn('[RateLimiter] Redis error:', err.message);
      redisReady = false;
    });
    client.on('ready', () => {
      redisReady = true;
    });
    await client.connect();
    redisClient = client as unknown as RedisLike;
    redisReady = true;
    console.warn('[RateLimiter] Redis connected — using distributed rate limiting');
    return redisClient;
  } catch (err: any) {
    console.warn('[RateLimiter] Redis unavailable, falling back to in-memory:', err.message);
    return null;
  }
}

/**
 * Check rate limit for a user. Uses Redis if available, otherwise in-memory.
 */
export async function checkRateLimitDistributed(
  userId: string,
  windowMs: number = RATE_LIMIT_WINDOW,
  maxRequests: number = RATE_LIMIT_MAX
): Promise<{ allowed: boolean; remainingRequests?: number }> {
  const client = await ensureRedis();

  if (client && redisReady) {
    return checkRateLimitRedis(client, userId, windowMs, maxRequests);
  }

  return checkRateLimitInMemory(userId, windowMs, maxRequests);
}

/**
 * Redis-based rate limiting using a sliding window counter.
 */
async function checkRateLimitRedis(
  client: RedisLike,
  userId: string,
  windowMs: number,
  maxRequests: number
): Promise<{ allowed: boolean; remainingRequests?: number }> {
  const key = `ratelimit:${userId}`;
  const windowSec = Math.ceil(windowMs / 1000);

  try {
    const count = await client.incr(key);

    if (count === 1) {
      // First request in this window — set expiry
      await client.expire(key, windowSec);
    }

    if (count > maxRequests) {
      return { allowed: false };
    }

    return { allowed: true, remainingRequests: maxRequests - count };
  } catch (err: any) {
    console.warn('[RateLimiter] Redis check failed, falling back to in-memory:', err.message);
    redisReady = false;
    return checkRateLimitInMemory(userId, windowMs, maxRequests);
  }
}

/**
 * In-memory rate limiting (same logic as the original implementation).
 */
function checkRateLimitInMemory(
  userId: string,
  windowMs: number = RATE_LIMIT_WINDOW,
  maxRequests: number = RATE_LIMIT_MAX
): { allowed: boolean; remainingRequests?: number } {
  const now = Date.now();
  const userLimit = rateLimitStore.get(userId);

  if (!userLimit || now > userLimit.resetAt) {
    rateLimitStore.set(userId, {
      count: 1,
      resetAt: now + windowMs,
    });
    return { allowed: true, remainingRequests: maxRequests - 1 };
  }

  if (userLimit.count >= maxRequests) {
    return { allowed: false };
  }

  userLimit.count++;
  return { allowed: true, remainingRequests: maxRequests - userLimit.count };
}
