import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { testConnection, createPurchaseOrder, POInput, getVendors } from '../shared/netsuiteClient';
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

    const { vendorName, vendorAccount, clientId, clientName, region, programCategory, amount, memo, lineItems, dryRun } = body;

    if (!vendorName || !amount || !lineItems?.length) {
      return { status: 400, headers: cors, jsonBody: { error: 'vendorName, amount, and lineItems are required' } };
    }

    const poInput: POInput = {
      vendorName,
      vendorAccount: vendorAccount || '',
      clientId: clientId || '',
      clientName: clientName || '',
      region: region || '',
      programCategory: programCategory || '',
      amount,
      memo: memo || '',
      lineItems,
    };

    // Default to dry run (safe mode) unless explicitly set to false
    const isDryRun = dryRun !== false;

    context.log(`[NetSuite] PO request by ${auth.userId} | dryRun=${isDryRun} | vendor=${vendorName} | amount=${amount}`);

    const result = await createPurchaseOrder(poInput, isDryRun);

    return {
      status: result.success ? 200 : 502,
      headers: cors,
      jsonBody: result,
    };
  },
});
