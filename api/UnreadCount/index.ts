import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { getMessagesContainer } from '../shared/cosmosClient';
import { validateEntraIdToken, isJwtToken } from '../shared/entraIdAuth';
import { checkRateLimit } from '../AuthToken';

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
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
  };
}

/**
 * GET /api/messages/unread-count
 * Returns the count of unread messages for the authenticated user.
 * Also returns per-submission breakdown for badge indicators.
 */
async function UnreadCount(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const origin = request.headers.get('origin') || '';
  const corsHeaders = getCorsHeaders(origin);

  if (request.method === 'OPTIONS') {
    return { status: 204, headers: corsHeaders };
  }

  // Auth
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

  const rateLimitCheck = checkRateLimit(validation.userId!);
  if (!rateLimitCheck.allowed) {
    return { status: 429, jsonBody: { error: 'Too many requests' }, headers: { ...corsHeaders, 'Retry-After': '60' } };
  }

  try {
    const container = await getMessagesContainer();
    const userEmail = validation.email!;

    // Count all messages not sent by this user and not read by this user
    const { resources } = await container.items.query<{ submissionId: string; unreadCount: number }>({
      query: `
        SELECT c.submissionId, COUNT(1) as unreadCount
        FROM c
        WHERE c.sentBy != @email
          AND NOT ARRAY_CONTAINS(c.readBy, @email)
        GROUP BY c.submissionId
      `,
      parameters: [
        { name: '@email', value: userEmail },
      ],
    }).fetchAll();

    const totalUnread = resources.reduce((sum, r) => sum + r.unreadCount, 0);
    const perSubmission: Record<string, number> = {};
    for (const r of resources) {
      perSubmission[r.submissionId] = r.unreadCount;
    }

    return {
      status: 200,
      jsonBody: {
        totalUnread,
        perSubmission,
      },
      headers: corsHeaders,
    };
  } catch (error: any) {
    context.error('Error getting unread count:', error);
    return { status: 500, jsonBody: { error: 'Internal server error' }, headers: corsHeaders };
  }
}

app.http('UnreadCount', {
  methods: ['GET', 'OPTIONS'],
  route: 'messages/unread-count',
  authLevel: 'anonymous',
  handler: UnreadCount,
});
