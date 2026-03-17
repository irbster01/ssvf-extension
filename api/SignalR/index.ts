import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { checkRateLimitDistributed } from '../shared/rateLimiter';
import { validateAuthWithRole } from '../shared/rbac';
import { getCorsHeaders as _getCors } from '../shared/cors';
import jwt from 'jsonwebtoken';

// SignalR Service REST API helpers
// Uses Azure SignalR Service in serverless mode

const SIGNALR_ENDPOINT = process.env.SIGNALR_ENDPOINT || '';
const SIGNALR_ACCESS_KEY = process.env.SIGNALR_ACCESS_KEY || '';
const SIGNALR_HUB = 'messages';

function getCorsHeaders(origin: string) {
  return _getCors(origin, 'POST, OPTIONS');
}

/**
 * Generate a HMAC-SHA256 JWT for SignalR client access.
 *
 * Azure SignalR Serverless mode requires:
 *  - aud: the client hub URL (no trailing slash before query)
 *  - nameid: user identifier (used for user-targeted messages)
 *  - exp/iat: standard JWT expiry claims
 */
function generateSignalRToken(userId: string, expiryMinutes: number = 60): string {
  const audience = `${SIGNALR_ENDPOINT}/client/?hub=${SIGNALR_HUB}`;
  const now = Math.floor(Date.now() / 1000);

  const payload: Record<string, any> = {
    aud: audience,
    iat: now,
    exp: now + expiryMinutes * 60,
    sub: userId,
    nameid: userId,   // Azure SignalR requires 'nameid' for user identity
  };

  return jwt.sign(payload, SIGNALR_ACCESS_KEY, { algorithm: 'HS256' });
}

/**
 * POST /api/signalr/negotiate
 * Returns the SignalR connection info for the authenticated user.
 * The client uses this to establish a WebSocket connection.
 */
async function SignalRNegotiate(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const origin = request.headers.get('origin') || '';
  const corsHeaders = getCorsHeaders(origin);

  if (request.method === 'OPTIONS') {
    return { status: 204, headers: corsHeaders };
  }

  // Validate auth via centralized RBAC
  const auth = await validateAuthWithRole(request, context);
  if (!auth.valid || !auth.email) {
    return { status: 401, jsonBody: { error: 'Unauthorized' }, headers: corsHeaders };
  }

  // Rate limit
  const rateLimitCheck = await checkRateLimitDistributed(auth.userId);
  if (!rateLimitCheck.allowed) {
    return { status: 429, jsonBody: { error: 'Too many requests' }, headers: { ...corsHeaders, 'Retry-After': '60' } };
  }

  if (!SIGNALR_ENDPOINT || !SIGNALR_ACCESS_KEY) {
    context.warn('SignalR is not configured (SIGNALR_ENDPOINT / SIGNALR_ACCESS_KEY missing)');
    return {
      status: 200,
      jsonBody: {
        url: null,
        accessToken: null,
        userId: auth.email,
        configured: false,
      },
      headers: corsHeaders,
    };
  }

  try {
    const signalRToken = generateSignalRToken(auth.email);
    const url = `${SIGNALR_ENDPOINT}/client/?hub=${SIGNALR_HUB}`;

    context.log('[SignalR] Negotiate successful');

    return {
      status: 200,
      jsonBody: {
        url,
        accessToken: signalRToken,
        userId: auth.email,
        configured: true,
      },
      headers: corsHeaders,
    };
  } catch (error: any) {
    context.error('SignalR negotiate error:', error);
    return { status: 500, jsonBody: { error: 'Internal server error' }, headers: corsHeaders };
  }
}

/**
 * Send a message to a specific user via SignalR REST API
 */
export async function sendSignalRMessage(
  userId: string,
  eventName: string,
  payload: any
): Promise<void> {
  if (!SIGNALR_ENDPOINT || !SIGNALR_ACCESS_KEY) {
    console.warn('[SignalR] Not configured — skipping push notification');
    return;
  }

  try {
    const audience = `${SIGNALR_ENDPOINT}/api/v1/hubs/${SIGNALR_HUB}/users/${encodeURIComponent(userId)}`;
    const now = Math.floor(Date.now() / 1000);
    const token = jwt.sign(
      { aud: audience, iat: now, exp: now + 300 },
      SIGNALR_ACCESS_KEY,
      { algorithm: 'HS256' }
    );

    const url = `${SIGNALR_ENDPOINT}/api/v1/hubs/${SIGNALR_HUB}/users/${encodeURIComponent(userId)}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        target: eventName,
        arguments: [payload],
      }),
    });

    if (!response.ok) {
      console.error(`[SignalR] Failed to send to ${userId}: ${response.status}`);
    } else {
      console.log(`[SignalR] Sent "${eventName}" successfully`);
    }
  } catch (error: any) {
    console.error('[SignalR] Send error:', error.message);
  }
}

app.http('SignalRNegotiate', {
  methods: ['POST', 'OPTIONS'],
  route: 'signalr/negotiate',
  authLevel: 'anonymous',
  handler: SignalRNegotiate,
});
