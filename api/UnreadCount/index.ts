import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { getMessagesContainer } from '../shared/cosmosClient';
import { checkRateLimitDistributed } from '../shared/rateLimiter';
import { validateAuthWithRole } from '../shared/rbac';
import { getCorsHeaders as _getCors } from '../shared/cors';

function getCorsHeaders(origin: string) {
  return _getCors(origin, 'GET, OPTIONS');
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

  // Auth via centralized RBAC
  const auth = await validateAuthWithRole(request, context);
  if (!auth.valid || !auth.email) {
    return { status: 401, jsonBody: { error: 'Unauthorized' }, headers: corsHeaders };
  }

  const rateLimitCheck = await checkRateLimitDistributed(auth.userId);
  if (!rateLimitCheck.allowed) {
    return { status: 429, jsonBody: { error: 'Too many requests' }, headers: { ...corsHeaders, 'Retry-After': '60' } };
  }

  try {
    const container = await getMessagesContainer();
    const userEmail = auth.email!;

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
