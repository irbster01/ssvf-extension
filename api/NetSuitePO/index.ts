import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { testConnection, createPurchaseOrder, POInput, getVendors, getAccounts, uploadAndAttachFiles } from '../shared/netsuiteClient';
import { downloadAttachment } from '../shared/blobStorage';
import { validateEntraIdToken, isJwtToken } from '../shared/entraIdAuth';

const ALLOWED_ORIGINS = [
  'https://wonderful-sand-00129870f.1.azurestaticapps.net',
  'https://ssvf.northla.app',
  'http://localhost:4280',
  'http://localhost:5173',
];

function getCorsHeaders(origin: string) {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
  };
}

async function validateAuth(request: HttpRequest, context: InvocationContext): Promise<{ valid: boolean; userId?: string }> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    context.warn('[NetSuite] Missing authorization header');
    return { valid: false };
  }
  const token = authHeader.substring(7);
  if (!isJwtToken(token)) return { valid: false };
  const validation = await validateEntraIdToken(token);
  return { valid: validation.valid, userId: validation.userId };
}

// ============ VENDOR LIST ENDPOINT ============
app.http('NetSuiteVendors', {
  methods: ['GET', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'netsuite/vendors',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    const origin = request.headers.get('origin') || '';
    const cors = getCorsHeaders(origin);

    if (request.method === 'OPTIONS') {
      return { status: 204, headers: cors };
    }

    const auth = await validateAuth(request, context);
    if (!auth.valid) {
      return { status: 401, headers: cors, jsonBody: { error: 'Unauthorized' } };
    }

    context.log(`[NetSuite] Vendor list requested by ${auth.userId}`);

    try {
      const vendors = await getVendors();
      return {
        status: 200,
        headers: cors,
        jsonBody: { vendors, count: vendors.length },
      };
    } catch (err) {
      context.error('[NetSuite] Vendor fetch error:', err);
      return {
        status: 502,
        headers: cors,
        jsonBody: { error: `Failed to fetch vendors: ${err instanceof Error ? err.message : String(err)}` },
      };
    }
  },
});

// ============ ACCOUNTS LIST ENDPOINT ============
app.http('NetSuiteAccounts', {
  methods: ['GET', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'netsuite/accounts',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    const origin = request.headers.get('origin') || '';
    const cors = getCorsHeaders(origin);

    if (request.method === 'OPTIONS') {
      return { status: 204, headers: cors };
    }

    const auth = await validateAuth(request, context);
    if (!auth.valid) {
      return { status: 401, headers: cors, jsonBody: { error: 'Unauthorized' } };
    }

    context.log(`[NetSuite] Account list requested by ${auth.userId}`);

    try {
      const accounts = await getAccounts();
      return {
        status: 200,
        headers: cors,
        jsonBody: { accounts, count: accounts.length },
      };
    } catch (err) {
      context.error('[NetSuite] Account fetch error:', err);
      return {
        status: 502,
        headers: cors,
        jsonBody: { error: `Failed to fetch accounts: ${err instanceof Error ? err.message : String(err)}` },
      };
    }
  },
});

// ============ TEST ENDPOINT ============
app.http('NetSuiteTest', {
  methods: ['GET', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'netsuite/test',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    const origin = request.headers.get('origin') || '';
    const cors = getCorsHeaders(origin);

    if (request.method === 'OPTIONS') {
      return { status: 204, headers: cors };
    }

    // Require authenticated user
    const auth = await validateAuth(request, context);
    if (!auth.valid) {
      return { status: 401, headers: cors, jsonBody: { error: 'Unauthorized' } };
    }

    context.log(`[NetSuite] Test connection requested by ${auth.userId}`);

    const result = await testConnection();
    return {
      status: result.success ? 200 : 502,
      headers: cors,
      jsonBody: result,
    };
  },
});

// ============ PURCHASE ORDER ENDPOINT ============
app.http('NetSuitePO', {
  methods: ['POST', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'netsuite/purchase-order',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    const origin = request.headers.get('origin') || '';
    const cors = getCorsHeaders(origin);

    if (request.method === 'OPTIONS') {
      return { status: 204, headers: cors };
    }

    const auth = await validateAuth(request, context);
    if (!auth.valid) {
      return { status: 401, headers: cors, jsonBody: { error: 'Unauthorized' } };
    }

    let body: any;
    try {
      body = await request.json();
    } catch {
      return { status: 400, headers: cors, jsonBody: { error: 'Invalid JSON body' } };
    }

    const { vendorName, vendorId, vendorAccount, clientId, clientName, region, programCategory, amount, memo, tfaNotes, lineItems, dryRun, clientTypeId, clientCategoryId, financialAssistanceTypeId, assistanceMonthId, attachmentBlobNames } = body;

    if (!vendorName || !amount || !lineItems?.length) {
      return { status: 400, headers: cors, jsonBody: { error: 'vendorName, amount, and lineItems are required' } };
    }

    const poInput: POInput = {
      vendorName,
      vendorId: vendorId || undefined,
      vendorAccount: vendorAccount || '',
      clientId: clientId || '',
      clientName: clientName || '',
      region: region || '',
      programCategory: programCategory || '',
      amount,
      memo: memo || '',
      tfaNotes: tfaNotes || '',
      clientTypeId: clientTypeId || undefined,
      clientCategoryId: clientCategoryId || undefined,
      financialAssistanceTypeId: financialAssistanceTypeId || undefined,
      assistanceMonthId: assistanceMonthId || undefined,
      lineItems,
    };

    // Default to dry run (safe mode) unless explicitly set to false
    const isDryRun = dryRun !== false;

    context.log(`[NetSuite] PO request by ${auth.userId} | dryRun=${isDryRun} | vendor=${vendorName} (id=${vendorId || 'none'}) | amount=${amount} | attachments=${(attachmentBlobNames as string[] || []).length}`);

    const result = await createPurchaseOrder(poInput, isDryRun);

    context.log(`[NetSuite] PO result: success=${result.success} | message=${result.message}${result.response ? ' | response=' + JSON.stringify(result.response).substring(0, 500) : ''}`);

    // After successful PO creation, upload attachments to NetSuite
    let attachmentResult: { attached: number; failed: number; errors: string[] } | undefined;
    if (result.success && !isDryRun && result.response?.internalId && Array.isArray(attachmentBlobNames) && attachmentBlobNames.length > 0) {
      context.log(`[NetSuite] Uploading ${attachmentBlobNames.length} attachment(s) to PO ${result.response.internalId}...`);
      try {
        // Download each attachment from Blob Storage
        const files: Array<{ fileName: string; buffer: Buffer; contentType: string }> = [];
        for (const blobName of attachmentBlobNames as string[]) {
          try {
            const downloaded = await downloadAttachment(blobName);
            files.push(downloaded);
          } catch (dlErr) {
            context.warn(`[NetSuite] Failed to download blob "${blobName}":`, dlErr);
          }
        }

        if (files.length > 0) {
          attachmentResult = await uploadAndAttachFiles(
            result.response.internalId,
            result.response.poId,
            files,
          );
          context.log(`[NetSuite] Attachment result: ${attachmentResult.attached} attached, ${attachmentResult.failed} failed`);
          if (attachmentResult.errors.length > 0) {
            context.warn(`[NetSuite] Attachment errors:`, attachmentResult.errors);
          }
        }
      } catch (err) {
        context.error('[NetSuite] Attachment upload error:', err);
        attachmentResult = { attached: 0, failed: (attachmentBlobNames as string[]).length, errors: [String(err)] };
      }
    }

    // Append attachment info to the response message
    if (attachmentResult) {
      const attachMsg = attachmentResult.failed === 0
        ? ` (${attachmentResult.attached} file${attachmentResult.attached !== 1 ? 's' : ''} attached)`
        : ` (${attachmentResult.attached}/${attachmentResult.attached + attachmentResult.failed} files attached)`;
      result.message += attachMsg;
      (result.response as any).attachments = attachmentResult;
    }

    return {
      status: result.success ? 200 : 502,
      headers: cors,
      jsonBody: result,
    };
  },
});
