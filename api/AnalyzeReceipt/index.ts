import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { DocumentAnalysisClient, AzureKeyCredential } from '@azure/ai-form-recognizer';
import { validateAuthWithRole } from '../shared/rbac';

const ALLOWED_ORIGINS = [
  'https://ssvf-capture-api.azurewebsites.net',
  'https://wscs.wellsky.com',
  'https://wonderful-sand-00129870f.1.azurestaticapps.net',
  'https://ssvf.northla.app',
  'http://localhost:4280',
  'http://localhost:5173',
];
const CHROME_EXTENSION_PATTERN = /^chrome-extension:\/\//;

function getCorsHeaders(origin: string) {
  const allowed = ALLOWED_ORIGINS.includes(origin) || CHROME_EXTENSION_PATTERN.test(origin);
  return {
    'Access-Control-Allow-Origin': allowed ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
  };
}

const ALLOWED_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf',
];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

/**
 * Infer assistance type from vendor name and item descriptions using keyword matching.
 * Returns null if no confident match can be made.
 */
function inferAssistanceType(vendorName: string, description: string): string | null {
  const text = `${vendorName} ${description}`.toLowerCase();

  if (/security\s*deposit/.test(text)) return 'Security Deposit';
  if (/utility\s*deposit/.test(text)) return 'Utility Deposit';
  if (/motel|hotel|inn\b|suites\b/.test(text)) return 'Motel/Hotel Voucher';
  if (/\bu-haul\b|uhaul|penske|moving\s*cost|move-in|moving\s*truck/.test(text)) return 'Moving Cost Assistance';
  if (/\btransport|\btaxi\b|uber|lyft|\bgreyhound\b|bus\s*pass|train\s*ticket/.test(text)) return 'Transportation';
  if (/entergy|swepco|cleco|centerpoint|atmos|xcel|electric\s*bill|gas\s*bill|water\s*bill|utility bill|utilities\b|sewage|natural\s*gas|electric\s*company|power\s*company/.test(text)) return 'Utility Assistance';
  if (/\brent\b|\brental\b|\blease\b|\bapartment\b|landlord|property\s*management/.test(text)) return 'Rental Assistance';
  if (/emergency\s*supply|moving\s*supply/.test(text)) return 'Emergency Supplies';

  return null;
}

let _diClient: DocumentAnalysisClient | null = null;
function getDIClient(): DocumentAnalysisClient {
  if (!_diClient) {
    const endpoint = process.env.DOCUMENT_INTELLIGENCE_ENDPOINT;
    const key = process.env.DOCUMENT_INTELLIGENCE_KEY;
    if (!endpoint || !key) {
      throw new Error('DOCUMENT_INTELLIGENCE_ENDPOINT and DOCUMENT_INTELLIGENCE_KEY must be configured');
    }
    _diClient = new DocumentAnalysisClient(endpoint, new AzureKeyCredential(key));
  }
  return _diClient;
}

/**
 * POST /api/receipts/analyze
 * Accepts a base64-encoded file (receipt or invoice) and returns structured field data
 * extracted by Azure Document Intelligence.
 */
export async function AnalyzeReceipt(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const origin = request.headers.get('origin') || '';
  const corsHeaders = getCorsHeaders(origin);

  if (request.method === 'OPTIONS') {
    return { status: 204, headers: corsHeaders };
  }

  const auth = await validateAuthWithRole(request, context);
  if (!auth.valid) {
    return { status: 401, jsonBody: { error: 'Unauthorized' }, headers: corsHeaders };
  }

  try {
    const body = await request.json() as {
      fileName: string;
      contentType: string;
      data: string; // base64-encoded
    };

    if (!body.data || !body.fileName) {
      return { status: 400, jsonBody: { error: 'fileName and data are required' }, headers: corsHeaders };
    }

    const contentType = body.contentType || 'application/octet-stream';
    if (!ALLOWED_TYPES.includes(contentType)) {
      return {
        status: 400,
        jsonBody: { error: `File type not supported for AI analysis: ${contentType}. Use JPEG, PNG, or PDF.` },
        headers: corsHeaders,
      };
    }

    const buffer = Buffer.from(body.data, 'base64');
    if (buffer.length > MAX_FILE_SIZE) {
      return { status: 400, jsonBody: { error: 'File too large for analysis (max 10 MB)' }, headers: corsHeaders };
    }

    context.log(`[AnalyzeReceipt] Analyzing: ${body.fileName} (${buffer.length} bytes)`);

    const client = getDIClient();
    const poller = await client.beginAnalyzeDocument('prebuilt-invoice', buffer);
    const result = await poller.pollUntilDone();

    const doc = result.documents?.[0];
    if (!doc) {
      context.log('[AnalyzeReceipt] No document detected');
      return {
        status: 200,
        jsonBody: { success: false, message: 'Could not extract data from this document' },
        headers: corsHeaders,
      };
    }

    const fields = doc.fields as Record<string, any>;

    // --- Vendor name ---
    const vendorField = fields['VendorName'] || fields['MerchantName'];
    const vendorName: string = vendorField?.content?.trim() || '';
    const vendorConfidence: number = vendorField?.confidence ?? 0;

    // --- Total amount ---
    const totalField = fields['InvoiceTotal'] || fields['Total'] || fields['AmountDue'];
    const totalValue = totalField?.value;
    const amount: number | null = (totalValue && typeof totalValue === 'object' && 'amount' in totalValue)
      ? totalValue.amount
      : (typeof totalValue === 'number' ? totalValue : null);
    const amountConfidence: number = totalField?.confidence ?? 0;

    // --- Invoice / transaction date ---
    const dateField = fields['InvoiceDate'] || fields['TransactionDate'] || fields['ServiceDate'];
    const dateValue = dateField?.value;
    let date: string | null = null;
    if (dateValue instanceof Date) {
      date = dateValue.toISOString().slice(0, 10);
    } else if (typeof dateValue === 'string' && dateValue.length >= 10) {
      date = dateValue.slice(0, 10);
    }
    const dateConfidence: number = dateField?.confidence ?? 0;

    // --- Line item descriptions for assistance type inference ---
    const itemsField = fields['Items'];
    const itemDescriptions: string[] = [];
    if (Array.isArray(itemsField?.value)) {
      for (const item of itemsField.value) {
        const desc = (item?.value as any)?.Description?.content;
        if (desc) itemDescriptions.push(desc.trim());
      }
    }

    const descriptionText = itemDescriptions.join(' ');
    const serviceAddress: string = fields['ServiceAddress']?.content || '';
    const assistanceType = inferAssistanceType(vendorName, `${descriptionText} ${serviceAddress}`);

    context.log(
      `[AnalyzeReceipt] vendor="${vendorName}"(${vendorConfidence.toFixed(2)}), ` +
      `amount=${amount}(${amountConfidence.toFixed(2)}), date=${date}(${dateConfidence.toFixed(2)}), ` +
      `type=${assistanceType}`
    );

    return {
      status: 200,
      jsonBody: {
        success: true,
        vendorName: vendorName || null,
        amount: amount,
        date: date,
        assistanceType: assistanceType,
        description: itemDescriptions.length > 0 ? itemDescriptions.join('; ') : null,
        confidence: {
          vendorName: vendorConfidence,
          amount: amountConfidence,
          date: dateConfidence,
        },
      },
      headers: corsHeaders,
    };

  } catch (error: any) {
    context.error('[AnalyzeReceipt] Error:', error);
    return {
      status: 500,
      jsonBody: { success: false, error: 'Receipt analysis failed', message: error.message },
      headers: corsHeaders,
    };
  }
}

app.http('AnalyzeReceipt', {
  methods: ['POST', 'OPTIONS'],
  route: 'receipts/analyze',
  authLevel: 'anonymous',
  handler: AnalyzeReceipt,
});
