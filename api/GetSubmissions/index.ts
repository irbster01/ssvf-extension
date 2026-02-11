import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { queryCaptures, updateCapture, ServiceCapture } from '../shared/cosmosClient';
import { validateEntraIdToken, isJwtToken } from '../shared/entraIdAuth';
import { checkRateLimit } from '../AuthToken';

// Allowed origins for the accounting dashboard
const ALLOWED_ORIGINS = [
  'https://ssvf-capture-api.azurewebsites.net',
  'https://wscs.wellsky.com',
  'https://wonderful-sand-00129870f.1.azurestaticapps.net',  // SWA dashboard
  'https://ssvf.northla.app',  // SWA custom domain
  'http://localhost:4280',  // Local dev
  'http://localhost:5173',  // Vite dev
];

function getCorsHeaders(origin: string) {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
  };
}

async function validateAuth(request: HttpRequest, context: InvocationContext): Promise<{ valid: boolean; userId?: string; email?: string }> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    context.warn('Missing or invalid authorization header');
    return { valid: false };
  }

  const token = authHeader.substring(7);

  if (!isJwtToken(token)) {
    context.warn('Non-JWT token rejected');
    return { valid: false };
  }

  const validation = await validateEntraIdToken(token);
  if (!validation.valid || !validation.userId) {
    context.warn('Invalid or expired Entra ID token');
    return { valid: false };
  }

  return { valid: true, userId: validation.userId, email: validation.email };
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
  const rateLimitCheck = checkRateLimit(auth.userId!);
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
      
      const submissions = await queryCaptures({ startDate, endDate, serviceType });
      
      context.log(`Found ${submissions.length} submissions`);
      
      return {
        status: 200,
        jsonBody: submissions,
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

export async function UpdateSubmission(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log('=== UpdateSubmission: Processing request ===');

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
  const rateLimitCheck = checkRateLimit(auth.userId!);
  if (!rateLimitCheck.allowed) {
    return {
      status: 429,
      jsonBody: { error: 'Too many requests' },
      headers: { ...corsHeaders, 'Retry-After': '60' },
    };
  }

  context.log(`✅ Authenticated: ${auth.email || auth.userId}`);

  try {
    // Get ID from route parameter
    const id = request.params.id;
    if (!id) {
      return {
        status: 400,
        jsonBody: { error: 'Missing submission ID' },
        headers: corsHeaders,
      };
    }

    const body = await request.json() as Partial<ServiceCapture> & { service_type: string };
    
    if (!body.service_type) {
      return {
        status: 400,
        jsonBody: { error: 'service_type is required' },
        headers: corsHeaders,
      };
    }

    // Only allow updating specific fields
    const allowedUpdates: Partial<ServiceCapture> = {};
    const editableFields: (keyof ServiceCapture)[] = [
      'client_id', 'client_name', 'vendor', 'vendor_account',
      'service_amount', 'region', 'program_category', 'status', 'notes', 'updated_by', 'updated_at'
    ];

    for (const field of editableFields) {
      if (body[field] !== undefined) {
        (allowedUpdates as any)[field] = body[field];
      }
    }

    context.log(`Updating submission ${id} with:`, allowedUpdates);

    const updated = await updateCapture(id, body.service_type, allowedUpdates);
    
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

app.http('UpdateSubmission', {
  methods: ['PATCH', 'OPTIONS'],
  route: 'submissions/{id}',
  authLevel: 'anonymous',
  handler: UpdateSubmission,
});
