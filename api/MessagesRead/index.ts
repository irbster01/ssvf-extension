import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { getMessagesContainer } from '../shared/cosmosClient';
import { validateEntraIdToken, isJwtToken } from '../shared/entraIdAuth';
import { checkRateLimit } from '../AuthToken';
import { Message } from '../shared/types';

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
    'Access-Control-Allow-Methods': 'PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
  };
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
    if (!readBy.includes(validation.email!)) {
      readBy.push(validation.email!);
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
    const userEmail = validation.email!;

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
