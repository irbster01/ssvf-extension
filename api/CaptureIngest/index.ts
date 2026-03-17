import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { saveCapture, ServiceCapture } from '../shared/cosmosClient';
import { CapturePayload } from '../shared/types';
import { validateToken } from '../AuthToken';
import { isJwtToken } from '../shared/entraIdAuth';
import { logAuditEvent, createBaseAuditEvent } from '../shared/auditLogger';
import { checkRateLimitDistributed } from '../shared/rateLimiter';
import { sendNotifyEmail, buildNewSubmissionEmail } from '../shared/graphClient';
import { validateAuthWithRole } from '../shared/rbac';
import { getCorsHeaders as _getCors } from '../shared/cors';

const MAX_PAYLOAD_SIZE = 1024 * 1024; // 1MB limit

export async function CaptureIngest(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const requestStart = Date.now();
  
  // CORS headers
  const origin = request.headers.get('origin') || '';
  const corsHeaders = _getCors(origin, 'POST, OPTIONS');

  // Handle preflight OPTIONS request
  if (request.method === 'OPTIONS') {
    return {
      status: 204,
      headers: corsHeaders,
    };
  }

  // Validate token-based authentication
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    context.warn('❌ Missing or invalid authorization header');
    return {
      status: 401,
      jsonBody: { error: 'Unauthorized' },
      headers: corsHeaders,
    };
  }

  const token = authHeader.substring(7);
  let userId: string | undefined;
  let userEmail: string | undefined;
  const baseAudit = createBaseAuditEvent(request, '/api/captures');
  
  // Determine token type and validate accordingly
  if (isJwtToken(token)) {
    // Use centralized RBAC auth for Entra ID tokens
    const rbacAuth = await validateAuthWithRole(request, context);
    if (!rbacAuth.valid) {
      logAuditEvent(context, { ...baseAudit, event: 'AUTH_FAILURE', success: false, details: { method: 'entra_id', reason: 'invalid_or_expired' } });
      return {
        status: 401,
        jsonBody: { error: 'Unauthorized' },
        headers: corsHeaders,
      };
    }
    userId = rbacAuth.email || rbacAuth.userId;
    userEmail = rbacAuth.email;
    logAuditEvent(context, { ...baseAudit, event: 'AUTH_SUCCESS', userId, email: userEmail, success: true, details: { method: 'entra_id', role: rbacAuth.role } });
  } else {
    // Legacy token (for backwards compatibility)
    const tokenValidation = validateToken(token);
    if (!tokenValidation.valid || !tokenValidation.userId) {
      logAuditEvent(context, { ...baseAudit, event: 'AUTH_FAILURE', success: false, details: { method: 'legacy', reason: 'invalid_or_expired' } });
      return {
        status: 401,
        jsonBody: { error: 'Unauthorized' },
        headers: corsHeaders,
      };
    }
    userId = tokenValidation.userId;
    logAuditEvent(context, { ...baseAudit, event: 'AUTH_SUCCESS', userId, success: true, details: { method: 'legacy' } });
  }

  // Rate limiting check
  const rateLimitCheck = await checkRateLimitDistributed(userId);
  if (!rateLimitCheck.allowed) {
    logAuditEvent(context, { ...baseAudit, event: 'RATE_LIMIT_EXCEEDED', userId, email: userEmail, success: false });
    return {
      status: 429,
      jsonBody: { error: 'Too many requests' },
      headers: {
        ...corsHeaders,
        'Retry-After': '60',
      },
    };
  }

  context.log(`✅ Rate limit OK - ${rateLimitCheck.remainingRequests} requests remaining`);

  try {
    // Check payload size before parsing
    const contentLength = request.headers.get('content-length');
    if (contentLength && parseInt(contentLength) > MAX_PAYLOAD_SIZE) {
      context.warn(`❌ Payload too large: ${contentLength} bytes`);
      return {
        status: 413,
        jsonBody: { error: 'Request too large' },
        headers: corsHeaders,
      };
    }

    // Parse request body
    const body = await request.json() as CapturePayload;

    // Validate required fields
    if (!body.source_url || typeof body.source_url !== 'string' || body.source_url.length > 2000) {
      context.warn('❌ Invalid source_url');
      return {
        status: 400,
        jsonBody: { error: 'Invalid request' },
        headers: corsHeaders,
      };
    }

    if (!body.form_data || typeof body.form_data !== 'object' || Array.isArray(body.form_data)) {
      context.warn('❌ Invalid form_data');
      return {
        status: 400,
        jsonBody: { error: 'Invalid request' },
        headers: corsHeaders,
      };
    }

    // Validate form_data doesn't exceed reasonable field count
    const fieldCount = Object.keys(body.form_data).length;
    if (fieldCount > 200) {
      context.warn(`❌ Too many form fields: ${fieldCount}`);
      return {
        status: 400,
        jsonBody: { error: 'Invalid request' },
        headers: corsHeaders,
      };
    }

    // Extract key fields from form_data for easier querying/reporting
    const formData = body.form_data;
    
    // Extract client_id from URL if not in form_data
    // URL format: ...#loadClient;clientId=8627310
    let clientIdFromUrl: string | undefined;
    const urlMatch = body.source_url.match(/clientId=(\d+)/);
    if (urlMatch) {
      clientIdFromUrl = urlMatch[1];
    }
    
    const extractedFields = {
      client_id: (formData.client_id || clientIdFromUrl) as string | undefined,
      client_name: (formData.client_name || formData.name_on_bill) as string | undefined,
      vendor: formData.vendor as string | undefined,
      vendor_id: formData.vendor_id as string | undefined,
      vendor_account: formData.vendor_client_account_number as string | undefined,
      service_amount: parseFloat(formData.service_cost_amount) || undefined,
      region: formData.region as ServiceCapture['region'],
      program_category: formData.program_category as ServiceCapture['program_category'],
      tfa_date: formData.tfa_date as string | undefined,
      notes: formData.notes as string | undefined,
    };

    // Build the capture document
    const capture: ServiceCapture = {
      user_id: userId,
      source_url: body.source_url,
      captured_at_utc: body.captured_at_utc || new Date().toISOString(),
      received_at_utc: new Date().toISOString(),
      service_type: body.service_type || 'TFA', // Default to TFA for SSVF
      form_data: formData,
      ...extractedFields,
    };

    // Save to Cosmos DB
    const docId = await saveCapture(capture);

    // Send email notification to accounting/SSVF team
    try {
      const { subject, html } = buildNewSubmissionEmail({
        submitterEmail: userEmail || userId,
        clientName: extractedFields.client_name,
        serviceType: capture.service_type,
        region: extractedFields.region,
        amount: extractedFields.service_amount,
        capturedAt: capture.captured_at_utc,
      });
      await sendNotifyEmail(subject, html);
    } catch (emailErr) {
      context.warn('[CaptureIngest] Email notification failed (non-blocking):', emailErr);
    }

    const duration = Date.now() - requestStart;
    context.log(`✅ SUCCESS (${duration}ms) - User: ${userId}, Fields: ${fieldCount}, DocId: ${docId}`);

    return {
      status: 200,
      jsonBody: {
        success: true,
        id: docId,
        timestamp: capture.received_at_utc,
      },
      headers: corsHeaders,
    };
  } catch (error) {
    const duration = Date.now() - requestStart;
    context.error(`❌ Error (${duration}ms):`, error);
    
    // Generic error message - don't expose internal details
    return {
      status: 500,
      jsonBody: {
        error: 'Server error',
      },
      headers: corsHeaders,
    };
  }
}

app.http('CaptureIngest', {
  methods: ['POST', 'OPTIONS'],
  route: 'captures',
  authLevel: 'anonymous',
  handler: CaptureIngest,
});
