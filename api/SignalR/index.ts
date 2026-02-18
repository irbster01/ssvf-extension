import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { validateEntraIdToken, isJwtToken } from '../shared/entraIdAuth';
import { checkRateLimit } from '../AuthToken';

// SignalR Service REST API helpers
// Uses Azure SignalR Service in serverless mode

const SIGNALR_ENDPOINT = process.env.SIGNALR_ENDPOINT || '';
const SIGNALR_ACCESS_KEY = process.env.SIGNALR_ACCESS_KEY || '';
const SIGNALR_HUB = 'messages';

const ALLOWED_ORIGINS = [
  'https://ssvf-capture-api.azurewebsites.net',
  'https://wscs.wellsky.com',
  'https://wonderful-sand-00129870f.1.azurestaticapps.net',
  'https://ssvf.northla.app',
  'http://localhost:4280',
  'http://localhost:5173',
];

function isAllowedOrigin(origin: string): boolean {
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  if (origin.startsWith('chrome-extension://')) return true;
  return false;
}

function getCorsHeaders(origin: string) {
  return {
    'Access-Control-Allow-Origin': isAllowedOrigin(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
  };
}

/**
 * Generate a HMAC-SHA256 JWT for SignalR client access
 */
function generateSignalRToken(userId: string, expiryMinutes: number = 60): string {
  // We use jsonwebtoken which is already in the project
  const jwt = require('jsonwebtoken');

  const audience = `${SIGNALR_ENDPOINT}/client/?hub=${SIGNALR_HUB}`;
  const now = Math.floor(Date.now() / 1000);

  const payload = {
    aud: audience,
    iat: now,
    exp: now + expiryMinutes * 60,
    sub: userId,
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

  // Validate auth
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { status: 401, jsonBody: { error: 'Unauthorized' }, headers: corsHeaders };
  }

  const token = authHeader.substring(7);
  if (!isJwtToken(token)) {
    return { status: 401, jsonBody: { error: 'Invalid token' }, headers: corsHeaders };
  }

  const validation = await validateEntraIdToken(token);
  if (!validation.valid || !validation.email) {
    return { status: 401, jsonBody: { error: 'Invalid token' }, headers: corsHeaders };
  }

  // Rate limit
  const rateLimitCheck = checkRateLimit(validation.userId!);
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
        userId: validation.email,
        configured: false,
      },
      headers: corsHeaders,
    };
  }

  try {
    const signalRToken = generateSignalRToken(validation.email);
    const url = `${SIGNALR_ENDPOINT}/client/?hub=${SIGNALR_HUB}`;

    context.log(`[SignalR] Negotiate for user: ${validation.email}`);

    return {
      status: 200,
      jsonBody: {
        url,
        accessToken: signalRToken,
        userId: validation.email,
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
    const jwt = require('jsonwebtoken');
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
      console.log(`[SignalR] Sent "${eventName}" to ${userId}`);
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
