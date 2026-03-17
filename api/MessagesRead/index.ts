import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { getMessagesContainer } from '../shared/cosmosClient';
import { checkRateLimitDistributed } from '../shared/rateLimiter';
import { Message } from '../shared/types';
import { validateAuthWithRole } from '../shared/rbac';
import { getCorsHeaders as _getCors } from '../shared/cors';

function getCorsHeaders(origin: string) {
  return _getCors(origin, 'PATCH, OPTIONS');
}

/**
 * PATCH /api/messages/{msgId}/read
 * Mark a message as read by the current user.
 * Body: { submissionId: string } (needed as partition key)
 */
async function MarkMessageRead(
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

  const msgId = request.params.msgId;
  if (!msgId) {
    return { status: 400, jsonBody: { error: 'Missing message ID' }, headers: corsHeaders };
  }

  let body: { submissionId: string };
  try {
    body = await request.json() as { submissionId: string };
  } catch {
    return { status: 400, jsonBody: { error: 'Invalid JSON body' }, headers: corsHeaders };
  }

  if (!body.submissionId) {
    return { status: 400, jsonBody: { error: 'submissionId is required' }, headers: corsHeaders };
  }

  try {
    const container = await getMessagesContainer();
    const { resource: existing } = await container.item(msgId, body.submissionId).read<Message>();

    if (!existing) {
      return { status: 404, jsonBody: { error: 'Message not found' }, headers: corsHeaders };
    }

    // Add current user to readBy if not already present
    const readBy = existing.readBy || [];
    if (!readBy.includes(auth.email!)) {
      readBy.push(auth.email!);
      const updated = { ...existing, readBy };
      await container.item(msgId, body.submissionId).replace(updated);
    }

    return {
      status: 200,
      jsonBody: { success: true },
      headers: corsHeaders,
    };
  } catch (error: any) {
    context.error('Error marking message read:', error);
    return { status: 500, jsonBody: { error: 'Internal server error' }, headers: corsHeaders };
  }
}

/**
 * PATCH /api/messages/read-thread
 * Mark all unread messages in a thread as read by the current user.
 * Body: { submissionId: string }
 */
async function MarkThreadRead(
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

  let body: { submissionId: string };
  try {
    body = await request.json() as { submissionId: string };
  } catch {
    return { status: 400, jsonBody: { error: 'Invalid JSON body' }, headers: corsHeaders };
  }

  if (!body.submissionId) {
    return { status: 400, jsonBody: { error: 'submissionId is required' }, headers: corsHeaders };
  }

  try {
    const container = await getMessagesContainer();
    const userEmail = auth.email!;

    // Find all messages in the thread not yet read by this user
    const { resources: unreadMessages } = await container.items.query<Message>({
      query: 'SELECT * FROM c WHERE c.submissionId = @submissionId AND NOT ARRAY_CONTAINS(c.readBy, @email)',
      parameters: [
        { name: '@submissionId', value: body.submissionId },
        { name: '@email', value: userEmail },
      ],
    }).fetchAll();

    // Update each to add user to readBy
    let markedCount = 0;
    for (const msg of unreadMessages) {
      const readBy = [...(msg.readBy || []), userEmail];
      await container.item(msg.id, body.submissionId).replace({ ...msg, readBy });
      markedCount++;
    }

    context.log(`[Messages] Marked ${markedCount} messages as read for ${userEmail} in thread ${body.submissionId}`);

    return {
      status: 200,
      jsonBody: { success: true, markedCount },
      headers: corsHeaders,
    };
  } catch (error: any) {
    context.error('Error marking thread read:', error);
    return { status: 500, jsonBody: { error: 'Internal server error' }, headers: corsHeaders };
  }
}

app.http('MarkMessageRead', {
  methods: ['PATCH', 'OPTIONS'],
  route: 'messages/{msgId}/read',
  authLevel: 'anonymous',
  handler: MarkMessageRead,
});

app.http('MarkThreadRead', {
  methods: ['PATCH', 'OPTIONS'],
  route: 'messages/read-thread',
  authLevel: 'anonymous',
  handler: MarkThreadRead,
});
