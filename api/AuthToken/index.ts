import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { randomBytes, createHash } from 'crypto';

// In-memory token store (legacy auth — used by Chrome extension only)
const tokenStore = new Map<string, { userId: string; createdAt: number; lastUsed: number }>();
const TOKEN_EXPIRY = 24 * 60 * 60 * 1000; // 24 hours

// Rate limiting store
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 10; // 10 requests per minute

function cleanupExpiredTokens() {
  const now = Date.now();
  for (const [token, data] of tokenStore.entries()) {
    if (now - data.createdAt > TOKEN_EXPIRY) {
      tokenStore.delete(token);
    }
  }
}

function generateSecureToken(userId: string): string {
  const randomToken = randomBytes(32).toString('hex');
  const hash = createHash('sha256').update(`${userId}-${randomToken}-${Date.now()}`).digest('hex');
  
  tokenStore.set(hash, {
    userId,
    createdAt: Date.now(),
    lastUsed: Date.now(),
  });
  
  return hash;
}

export async function AuthToken(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  // CORS headers - RESTRICTED to specific origin
  const origin = request.headers.get('origin') || '';
  const allowedOrigins = ['https://wscs.wellsky.com'];
  
  const corsHeaders = {
    'Access-Control-Allow-Origin': allowedOrigins.includes(origin) ? origin : allowedOrigins[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Credentials': 'true',
  };

  if (request.method === 'OPTIONS') {
    return { status: 204, headers: corsHeaders };
  }

  try {
    // Clean up expired tokens periodically
    if (Math.random() < 0.1) cleanupExpiredTokens();

    const body = await request.json() as { userId: string };
    
    if (!body.userId || typeof body.userId !== 'string') {
      return {
        status: 400,
        jsonBody: { error: 'Invalid request' },
        headers: corsHeaders,
      };
    }

    // Generate and return session token
    const token = generateSecureToken(body.userId);
    
    context.log(`✅ Generated auth token for user: ${body.userId}`);
    
    return {
      status: 200,
      jsonBody: {
        token,
        expiresIn: TOKEN_EXPIRY,
      },
      headers: corsHeaders,
    };
  } catch (error) {
    context.error('Auth token error:', error);
    return {
      status: 500,
      jsonBody: { error: 'Server error' },
      headers: corsHeaders,
    };
  }
}

export function validateToken(token: string): { valid: boolean; userId?: string } {
  const data = tokenStore.get(token);
  
  if (!data) {
    return { valid: false };
  }
  
  const now = Date.now();
  
  // Check expiry
  if (now - data.createdAt > TOKEN_EXPIRY) {
    tokenStore.delete(token);
    return { valid: false };
  }
  
  // Update last used
  data.lastUsed = now;
  
  return { valid: true, userId: data.userId };
}

export function checkRateLimit(userId: string): { allowed: boolean; remainingRequests?: number } {
  const now = Date.now();
  const userLimit = rateLimitStore.get(userId);
  
  if (!userLimit || now > userLimit.resetAt) {
    // Reset or create new limit
    rateLimitStore.set(userId, {
      count: 1,
      resetAt: now + RATE_LIMIT_WINDOW,
    });
    return { allowed: true, remainingRequests: RATE_LIMIT_MAX - 1 };
  }
  
  if (userLimit.count >= RATE_LIMIT_MAX) {
    return { allowed: false };
  }
  
  userLimit.count++;
  return { allowed: true, remainingRequests: RATE_LIMIT_MAX - userLimit.count };
}

app.http('AuthToken', {
  methods: ['POST', 'OPTIONS'],
  route: 'auth/token',
  authLevel: 'anonymous',
  handler: AuthToken,
});
