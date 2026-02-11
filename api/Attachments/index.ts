import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { uploadAttachment, getAttachmentDownloadUrl, AttachmentMeta } from '../shared/blobStorage';
import { getContainer, ServiceCapture } from '../shared/cosmosClient';
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

// Allow chrome extension origin
const CHROME_EXTENSION_PATTERN = /^chrome-extension:\/\//;

function getCorsHeaders(origin: string) {
  const allowed = ALLOWED_ORIGINS.includes(origin) || CHROME_EXTENSION_PATTERN.test(origin);
  return {
    'Access-Control-Allow-Origin': allowed ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
  };
}

async function validateAuth(request: HttpRequest, context: InvocationContext) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return { valid: false as const };
  }
  const token = authHeader.substring(7);
  if (!isJwtToken(token)) return { valid: false as const };

  const validation = await validateEntraIdToken(token);
  if (!validation.valid || !validation.userId) return { valid: false as const };

  return { valid: true as const, userId: validation.userId, email: validation.email };
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain', 'text/csv',
];

/**
 * POST /api/submissions/{id}/attachments - Upload an attachment
 * Expects multipart form data with file + metadata
 */
export async function UploadAttachment(
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

  const rateLimitCheck = checkRateLimit(auth.userId!);
  if (!rateLimitCheck.allowed) {
    return { status: 429, jsonBody: { error: 'Too many requests' }, headers: { ...corsHeaders, 'Retry-After': '60' } };
  }

  const submissionId = request.params.id;
  if (!submissionId) {
    return { status: 400, jsonBody: { error: 'Missing submission ID' }, headers: corsHeaders };
  }

  try {
    // Parse the JSON body with base64-encoded file
    const body = await request.json() as {
      fileName: string;
      contentType: string;
      data: string; // base64
      serviceType: string;
    };

    if (!body.fileName || !body.data || !body.serviceType) {
      return { status: 400, jsonBody: { error: 'fileName, data, and serviceType are required' }, headers: corsHeaders };
    }

    if (!ALLOWED_TYPES.includes(body.contentType)) {
      return { status: 400, jsonBody: { error: `File type not allowed: ${body.contentType}` }, headers: corsHeaders };
    }

    const buffer = Buffer.from(body.data, 'base64');

    if (buffer.length > MAX_FILE_SIZE) {
      return { status: 400, jsonBody: { error: `File too large. Max ${MAX_FILE_SIZE / 1024 / 1024}MB` }, headers: corsHeaders };
    }

    context.log(`Uploading attachment for submission ${submissionId}: ${body.fileName} (${buffer.length} bytes)`);

    // Upload to blob storage
    const attachment = await uploadAttachment(
      submissionId,
      body.fileName,
      body.contentType,
      buffer,
      auth.email || auth.userId
    );

    // Update the Cosmos DB document to include attachment metadata
    const container = await getContainer();
    const partitionKey = body.serviceType || 'TFA';
    const { resource: existing } = await container.item(submissionId, partitionKey).read<ServiceCapture>();

    if (!existing) {
      return { status: 404, jsonBody: { error: 'Submission not found' }, headers: corsHeaders };
    }

    const attachments: AttachmentMeta[] = (existing as any).attachments || [];
    attachments.push(attachment);

    await container.item(submissionId, partitionKey).replace({
      ...existing,
      attachments,
    });

    context.log(`✅ Attachment uploaded: ${attachment.blobName}`);

    return {
      status: 200,
      jsonBody: attachment,
      headers: corsHeaders,
    };
  } catch (error: any) {
    context.error('Error uploading attachment:', error);
    return { status: 500, jsonBody: { error: 'Failed to upload attachment' }, headers: corsHeaders };
  }
}

/**
 * GET /api/attachments/{*blobPath} - Get a download URL for an attachment
 */
export async function GetAttachmentUrl(
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

  try {
    const blobName = request.query.get('blob');
    if (!blobName) {
      return { status: 400, jsonBody: { error: 'Missing blob parameter' }, headers: corsHeaders };
    }

    context.log(`Generating download URL for: ${blobName}`);
    const url = await getAttachmentDownloadUrl(blobName);

    return {
      status: 200,
      jsonBody: { url },
      headers: corsHeaders,
    };
  } catch (error: any) {
    context.error('Error generating download URL:', error);
    return { status: 500, jsonBody: { error: 'Failed to generate download URL' }, headers: corsHeaders };
  }
}

// Register Azure Functions
app.http('UploadAttachment', {
  methods: ['POST', 'OPTIONS'],
  route: 'submissions/{id}/attachments',
  authLevel: 'anonymous',
  handler: UploadAttachment,
});

app.http('GetAttachmentUrl', {
  methods: ['GET', 'OPTIONS'],
  route: 'attachments/download',
  authLevel: 'anonymous',
  handler: GetAttachmentUrl,
});
