import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { queryCaptures, queryCapturesPaginated, updateCapture, getContainer, ServiceCapture } from '../shared/cosmosClient';
import { validateEntraIdToken, isJwtToken } from '../shared/entraIdAuth';
import { checkRateLimitDistributed } from '../shared/rateLimiter';
import { sendEmail, sendNotifyEmail, buildCorrectionNeededEmail, buildCorrectionCompletedEmail, NOTIFY_MAILBOX } from '../shared/graphClient';
import { validateAuthWithRole, isElevated, AuthResult } from '../shared/rbac';
import { getCorsHeaders as _getCors } from '../shared/cors';

function getCorsHeaders(origin: string) {
  return _getCors(origin, 'GET, PATCH, OPTIONS');
}

async function validateAuth(request: HttpRequest, context: InvocationContext): Promise<AuthResult> {
  return validateAuthWithRole(request, context);
}

export async function GetSubmissions(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log('=== GetSubmissions: Processing request ===');

  const origin = request.headers.get('origin') || '';
  const corsHeaders = getCorsHeaders(origin);

  // Handle preflight OPTIONS request
  if (request.method === 'OPTIONS') {
    return { status: 204, headers: corsHeaders };
  }

  // Validate authentication
  const auth = await validateAuth(request, context);
  if (!auth.valid) {
    return {
      status: 401,
      jsonBody: { error: 'Unauthorized' },
      headers: corsHeaders,
    };
  }

  // Rate limiting
  const rateLimitCheck = await checkRateLimitDistributed(auth.userId!);
  if (!rateLimitCheck.allowed) {
    return {
      status: 429,
      jsonBody: { error: 'Too many requests' },
      headers: { ...corsHeaders, 'Retry-After': '60' },
    };
  }

  context.log(`✅ Authenticated: ${auth.email || auth.userId}`);

  try {
    if (request.method === 'GET') {
      // GET: Fetch submissions
      const startDate = request.query.get('startDate') || undefined;
      const endDate = request.query.get('endDate') || undefined;
      const serviceType = request.query.get('serviceType') || undefined;

      // RBAC: regular users always see only their own submissions
      let userId: string | undefined;
      if (isElevated(auth.role)) {
        // Elevated users can optionally filter to their own via ?myOnly=true
        const myOnly = request.query.get('myOnly') === 'true';
        userId = myOnly ? (auth.email || auth.userId) : (request.query.get('userId') || undefined);
      } else {
        // Regular users are ALWAYS scoped to their own submissions
        userId = auth.email || auth.userId;
      }
      
      // Parse pagination params
      const limit = Math.min(parseInt(request.query.get('limit') || '200', 10), 500);
      const offset = parseInt(request.query.get('offset') || '0', 10);

      const result = await queryCapturesPaginated({ startDate, endDate, serviceType, userId, limit, offset });
      
      context.log(`Found ${result.items.length} of ${result.totalCount} submissions`);
      
      return {
        status: 200,
        jsonBody: {
          submissions: result.items,
          role: auth.role,
          totalCount: result.totalCount,
          offset: result.offset,
          limit: result.limit,
          hasMore: result.hasMore,
        },
        headers: corsHeaders,
      };
    }

    return {
      status: 405,
      jsonBody: { error: 'Method not allowed' },
      headers: corsHeaders,
    };

  } catch (error: any) {
    context.error('Error processing request:', error);
    
    return {
      status: 500,
      jsonBody: { error: 'Internal server error' },
      headers: corsHeaders,
    };
  }
}

export async function SubmissionById(
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

  const rateLimitCheck = await checkRateLimitDistributed(auth.userId!);
  if (!rateLimitCheck.allowed) {
    return { status: 429, jsonBody: { error: 'Too many requests' }, headers: { ...corsHeaders, 'Retry-After': '60' } };
  }

  const id = request.params.id;
  if (!id) {
    return { status: 400, jsonBody: { error: 'Missing submission ID' }, headers: corsHeaders };
  }

  // ── GET: fetch single submission ──
  if (request.method === 'GET') {
    try {
      const cont = await getContainer();
      const { resources } = await cont.items.query<ServiceCapture>({
        query: 'SELECT * FROM c WHERE c.id = @id',
        parameters: [{ name: '@id', value: id }],
      }).fetchAll();

      if (resources.length === 0) {
        return { status: 404, jsonBody: { error: 'Submission not found' }, headers: corsHeaders };
      }

      const submission = resources[0];

      // Non-elevated users can only see their own submissions
      if (!isElevated(auth.role)) {
        const userEmail = (auth.email || auth.userId || '').toLowerCase();
        if ((submission.user_id || '').toLowerCase() !== userEmail) {
          return { status: 403, jsonBody: { error: 'Forbidden' }, headers: corsHeaders };
        }
      }

      return { status: 200, jsonBody: submission, headers: corsHeaders };
    } catch (error: any) {
      context.error('Error fetching submission by ID:', error);
      return { status: 500, jsonBody: { error: 'Internal server error' }, headers: corsHeaders };
    }
  }

  // ── PATCH: update submission ──
  context.log(`✅ UpdateSubmission Authenticated: ${auth.email || auth.userId} (role=${auth.role})`);

  try {

    const body = await request.json() as Partial<ServiceCapture> & { service_type: string };
    
    if (!body.service_type) {
      return {
        status: 400,
        jsonBody: { error: 'service_type is required' },
        headers: corsHeaders,
      };
    }

    // Read the existing document BEFORE updating so we can detect status transitions + ownership
    const cont = await getContainer();
    const { resource: existingDoc } = await cont.item(id, body.service_type).read<ServiceCapture>();
    const previousStatus = existingDoc?.status || 'New';

    // RBAC: check ownership for regular users
    if (!isElevated(auth.role)) {
      const submissionOwner = (existingDoc?.user_id || '').toLowerCase();
      const currentUser = (auth.email || '').toLowerCase();
      if (submissionOwner !== currentUser) {
        return {
          status: 403,
          jsonBody: { error: 'You can only edit your own submissions' },
          headers: corsHeaders,
        };
      }
    }

    // Only allow updating specific fields
    const allowedUpdates: Partial<ServiceCapture> = {};

    // Fields anyone who owns the submission can edit
    const editableFields: (keyof ServiceCapture)[] = [
      'client_id', 'client_name', 'vendor', 'vendor_id',
      'service_amount', 'region', 'program_category', 'notes', 'updated_by', 'updated_at',
    ];

    // Elevated-only fields: status, PO, entered-in-system
    if (isElevated(auth.role)) {
      editableFields.push(
        'status', 'po_number', 'entered_in_system', 'entered_in_system_by', 'entered_in_system_at'
      );
    } else if (previousStatus === 'Corrections' && body.status === 'In Review') {
      // Allow submitter to move their own submission back to "In Review" after corrections
      editableFields.push('status');
    }

    for (const field of editableFields) {
      if (body[field] !== undefined) {
        (allowedUpdates as any)[field] = body[field];
      }
    }

    // When sending back for corrections, persist who requested it
    const newStatus = allowedUpdates.status;
    if (newStatus === 'Corrections' && previousStatus !== 'Corrections' && isElevated(auth.role)) {
      allowedUpdates.corrections_requested_by = auth.email || auth.userId || 'Accounting';
    }

    context.log(`Updating submission ${id} with:`, allowedUpdates);

    const updated = await updateCapture(id, body.service_type, allowedUpdates);

    // ── Email notifications based on status transitions ──
    try {
      if (newStatus === 'Corrections' && previousStatus !== 'Corrections') {
        // Status changed TO "Corrections" → email the submitter

        const submitterEmail = existingDoc?.user_id;
        if (submitterEmail && submitterEmail !== 'unknown') {
          const { subject, html } = buildCorrectionNeededEmail({
            clientName: existingDoc?.client_name,
            requestedBy: allowedUpdates.corrections_requested_by || auth.email || auth.userId || 'Accounting',
            submissionDate: existingDoc?.captured_at_utc,
          });
          await sendEmail(submitterEmail, subject, html);
          context.log(`[UpdateSubmission] Correction-needed email sent → ${submitterEmail}`);
        }
      } else if (newStatus === 'In Review' && previousStatus === 'Corrections') {
        // Status changed FROM "Corrections" TO "In Review" → email ssvf-notify AND the requester
        const { subject, html } = buildCorrectionCompletedEmail({
          clientName: updated.client_name || existingDoc?.client_name,
          correctedBy: auth.email || auth.userId || 'Unknown',
          submissionDate: existingDoc?.captured_at_utc,
        });
        await sendNotifyEmail(subject, html);
        context.log(`[UpdateSubmission] Correction-completed email sent → ssvf-notify`);

        // Also notify the individual who sent it back for corrections
        const requester = existingDoc?.corrections_requested_by || updated.corrections_requested_by;
        if (requester && requester !== 'Accounting' && requester !== NOTIFY_MAILBOX()) {
          await sendEmail(requester, subject, html);
          context.log(`[UpdateSubmission] Correction-completed email also sent → ${requester}`);
        }
      }
    } catch (emailErr) {
      context.warn('[UpdateSubmission] Email notification failed (non-blocking):', emailErr);
    }
    
    return {
      status: 200,
      jsonBody: updated,
      headers: corsHeaders,
    };

  } catch (error: any) {
    context.error('Error updating submission:', error);
    
    if (error.message?.includes('not found')) {
      return {
        status: 404,
        jsonBody: { error: 'Submission not found' },
        headers: corsHeaders,
      };
    }
    
    return {
      status: 500,
      jsonBody: { error: 'Internal server error' },
      headers: corsHeaders,
    };
  }
}

app.http('GetSubmissions', {
  methods: ['GET', 'OPTIONS'],
  route: 'submissions',
  authLevel: 'anonymous',
  handler: GetSubmissions,
});

app.http('SubmissionById', {
  methods: ['GET', 'PATCH', 'OPTIONS'],
  route: 'submissions/{id}',
  authLevel: 'anonymous',
  handler: SubmissionById,
});
