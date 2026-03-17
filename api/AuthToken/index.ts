import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { randomBytes, createHash } from 'crypto';
import { logAuditEvent, createBaseAuditEvent } from '../shared/auditLogger';

// In-memory token store (legacy auth — used by Chrome extension only)
const tokenStore = new Map<string, { userId: string; createdAt: number; lastUsed: number }>();
const TOKEN_EXPIRY = 24 * 60 * 60 * 1000; // 24 hours

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
  // AuthToken is legacy — only the WellSky content script uses it.
  // Keep restricted to that single origin.
  const origin = request.headers.get('origin') || '';
  const allowed = origin === 'https://wscs.wellsky.com';
  const corsHeaders = {
    'Access-Control-Allow-Origin': allowed ? origin : 'https://wscs.wellsky.com',
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
    
    logAuditEvent(context, {
      ...createBaseAuditEvent(request, '/api/auth/token'),
      event: 'AUTH_SUCCESS',
      userId: body.userId,
      success: true,
    });
    
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
    logAuditEvent(context, {
      ...createBaseAuditEvent(request, '/api/auth/token'),
      event: 'AUTH_FAILURE',
      success: false,
      details: { reason: 'server_error' },
    });
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

app.http('AuthToken', {
  methods: ['POST', 'OPTIONS'],
  route: 'auth/token',
  authLevel: 'anonymous',
  handler: AuthToken,
});
