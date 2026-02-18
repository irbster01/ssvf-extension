import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { getMessagesContainer, getContainer } from '../shared/cosmosClient';
import { validateEntraIdToken, isJwtToken } from '../shared/entraIdAuth';
import { checkRateLimit } from '../AuthToken';
import { Message, MessagePayload } from '../shared/types';
import { sendSignalRMessage } from '../SignalR';
import { sendEmail, buildMessageNotificationEmail } from '../shared/graphClient';

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
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
  };
}

async function validateAuth(request: HttpRequest, context: InvocationContext) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { valid: false as const };
  }
  const token = authHeader.substring(7);
  if (!isJwtToken(token)) {
    return { valid: false as const };
  }
  const validation = await validateEntraIdToken(token);
  if (!validation.valid || !validation.userId) {
    return { valid: false as const };
  }
  return { valid: true as const, userId: validation.userId, email: validation.email || '', userName: validation.userName || '' };
}

/**
 * GET /api/submissions/{id}/messages
 * Fetch all messages for a submission thread, ordered by sentAt ascending.
 */
async function GetMessages(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const origin = request.headers.get('origin') || '';
  const corsHeaders = getCorsHeaders(origin);

  if (request.method === 'OPTIONS') {
    return { status: 204, headers: corsHeaders };
  }

  const auth = await validateAuth(request, context);
  if (!auth.valid) {
    return { status: 401, jsonBody: { error: 'Unauthorized' }, headers: corsHeaders };
  }

  const rateLimitCheck = checkRateLimit(auth.userId);
  if (!rateLimitCheck.allowed) {
    return { status: 429, jsonBody: { error: 'Too many requests' }, headers: { ...corsHeaders, 'Retry-After': '60' } };
  }

  const submissionId = request.params.id;
  if (!submissionId) {
    return { status: 400, jsonBody: { error: 'Missing submission ID' }, headers: corsHeaders };
  }

  try {
    const container = await getMessagesContainer();
    const { resources } = await container.items.query<Message>({
      query: 'SELECT * FROM c WHERE c.submissionId = @submissionId ORDER BY c.sentAt ASC',
      parameters: [{ name: '@submissionId', value: submissionId }],
    }).fetchAll();

    return {
      status: 200,
      jsonBody: resources,
      headers: corsHeaders,
    };
  } catch (error: any) {
    context.error('Error fetching messages:', error);
    return { status: 500, jsonBody: { error: 'Internal server error' }, headers: corsHeaders };
  }
}

/**
 * POST /api/submissions/{id}/messages
 * Send a new message on a submission thread.
 * Triggers SignalR push and email notification to the submission's user.
 */
async function PostMessage(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const origin = request.headers.get('origin') || '';
  const corsHeaders = getCorsHeaders(origin);

  if (request.method === 'OPTIONS') {
    return { status: 204, headers: corsHeaders };
  }

  const auth = await validateAuth(request, context);
  if (!auth.valid) {
    return { status: 401, jsonBody: { error: 'Unauthorized' }, headers: corsHeaders };
  }

  const rateLimitCheck = checkRateLimit(auth.userId);
  if (!rateLimitCheck.allowed) {
    return { status: 429, jsonBody: { error: 'Too many requests' }, headers: { ...corsHeaders, 'Retry-After': '60' } };
  }

  const submissionId = request.params.id;
  if (!submissionId) {
    return { status: 400, jsonBody: { error: 'Missing submission ID' }, headers: corsHeaders };
  }

  let body: MessagePayload;
  try {
    body = await request.json() as MessagePayload;
  } catch {
    return { status: 400, jsonBody: { error: 'Invalid JSON body' }, headers: corsHeaders };
  }

  if (!body.text || !body.text.trim()) {
    return { status: 400, jsonBody: { error: 'Message text is required' }, headers: corsHeaders };
  }

  const serviceType = body.service_type || 'TFA';

  try {
    // Create message document
    const messageId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const message: Message = {
      id: messageId,
      submissionId,
      service_type: serviceType,
      text: body.text.trim(),
      sentBy: auth.email,
      sentByName: auth.userName,
      sentAt: new Date().toISOString(),
      readBy: [auth.email], // Sender has read their own message
    };

    const container = await getMessagesContainer();
    await container.items.create(message);

    context.log(`[Messages] Created message ${messageId} on submission ${submissionId} by ${auth.email}`);

    // Look up the submission to find the caseworker's email and client info
    let recipientEmail: string | null = null;
    let clientName: string | undefined;
    let submissionDate: string | undefined;

    try {
      const capturesContainer = await getContainer();
      const { resource: submission } = await capturesContainer.item(submissionId, serviceType).read();
      if (submission) {
        clientName = submission.client_name;
        submissionDate = submission.captured_at_utc;

        // Determine who to notify:
        // If the sender is the submission's user, notify no one specific (accounting will see via polling/SignalR)
        // If the sender is NOT the submission's user, notify the submission's user
        // Also: updated_by tracks last editor — could be accounting
        // We'll use a heuristic: get the user_id (email from captures) and notify them if different from sender
        const submissionUserEmail = submission.user_id;

        if (submissionUserEmail && submissionUserEmail !== auth.email && submissionUserEmail !== 'unknown') {
          recipientEmail = submissionUserEmail;
        }
      }
    } catch (err) {
      context.warn('Could not look up submission for notification:', err);
    }

    // Send SignalR push notification
    // Broadcast to all users who should see this — for now, send to everyone in the thread
    // The simplest approach: if we have a specific recipient, push to them
    if (recipientEmail) {
      await sendSignalRMessage(recipientEmail, 'newMessage', {
        submissionId,
        messageId,
        senderName: auth.userName || auth.email,
        senderEmail: auth.email,
        preview: body.text.trim().substring(0, 100),
        clientName,
      });

      // Send email notification
      const { subject, html } = buildMessageNotificationEmail({
        senderName: auth.userName || auth.email,
        messageText: body.text.trim(),
        clientName,
        submissionDate,
        dashboardUrl: 'https://ssvf.northla.app',
      });
      await sendEmail(recipientEmail, subject, html);
    }

    // Also push to the sender (so their other open tabs/extension update in real-time)
    await sendSignalRMessage(auth.email, 'messageSent', {
      submissionId,
      messageId,
    });

    return {
      status: 201,
      jsonBody: message,
      headers: corsHeaders,
    };
  } catch (error: any) {
    context.error('Error creating message:', error);
    return { status: 500, jsonBody: { error: 'Internal server error' }, headers: corsHeaders };
  }
}

// Single registration handling GET + POST on the same route
app.http('Messages', {
  methods: ['GET', 'POST', 'OPTIONS'],
  route: 'submissions/{id}/messages',
  authLevel: 'anonymous',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    if (request.method === 'GET' || (request.method === 'OPTIONS' && request.headers.get('access-control-request-method') !== 'POST')) {
      return GetMessages(request, context);
    }
    return PostMessage(request, context);
  },
});
