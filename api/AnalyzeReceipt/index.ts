import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { DocumentAnalysisClient, AzureKeyCredential } from '@azure/ai-form-recognizer';
import { validateAuthWithRole } from '../shared/rbac';
import { getClientsContainer } from '../shared/cosmosClient';
import {
  ClientRecord,
  buildClientIndex,
  matchClientInText,
  inferAssistanceType,
  inferRegion,
  normalize,
} from '../shared/receiptMatching';
import { getCorsHeaders as _getCors } from '../shared/cors';

function getCorsHeaders(origin: string) {
  return _getCors(origin, 'POST, OPTIONS');
}

const ALLOWED_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf',
];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

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

// ── Client index cache (rebuilds every 10 minutes) ──
let indexCache: { index: Map<string, any>; fetchedAt: number } | null = null;
const CLIENT_CACHE_TTL = 10 * 60 * 1000;

async function getCachedClientIndex(): Promise<Map<string, any>> {
  if (indexCache && Date.now() - indexCache.fetchedAt < CLIENT_CACHE_TTL) {
    return indexCache.index;
  }
  const container = await getClientsContainer();
  const { resources } = await container.items
    .query<ClientRecord>('SELECT c.id, c.clientName, c.program, c.region FROM c')
    .fetchAll();
  const index = buildClientIndex(resources);
  indexCache = { index, fetchedAt: Date.now() };
  return index;
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
    const vendorAddress: string = fields['VendorAddress']?.content || fields['RemittanceAddress']?.content || '';
    const combinedAddress = `${vendorAddress} ${serviceAddress}`.trim();
    // Include file name in assistance type inference — caseworkers often put receipt type in filename
    const fileNameForInference = (body.fileName || '').replace(/[_\-\.]/g, ' ').replace(/\.(pdf|jpg|jpeg|png|gif|webp)$/i, '');
    const assistanceType = inferAssistanceType(vendorName, `${descriptionText} ${serviceAddress} ${fileNameForInference}`);
    const region = inferRegion(combinedAddress);

    // --- Client name matching from OCR text + file name ---
    // Caseworkers often write client names on receipts or in the file name
    // Common pattern: "J. Smith rent receipt.pdf" or "JSmith_utility.jpg"
    let clientMatch: { clientId: string; clientName: string; program?: string; region?: string; confidence: number; matchType: string } | null = null;
    try {
      const fullText = result.content || '';  // Full OCR text from Document Intelligence
      // Include the file name in matching — caseworkers put client names + receipt type there
      const fileNameClean = (body.fileName || '').replace(/[_\-\.]/g, ' ').replace(/\.(pdf|jpg|jpeg|png|gif|webp)$/i, '');
      const combinedText = `${fileNameClean} ${fullText}`;
      const clientIndex = await getCachedClientIndex();
      const match = matchClientInText(combinedText, clientIndex);
      if (match) {
        clientMatch = {
          clientId: match.client.id,
          clientName: match.client.clientName,
          program: match.client.program,
          region: match.client.region,
          confidence: match.confidence,
          matchType: match.matchType,
        };
      }
    } catch (clientErr) {
      context.warn('[AnalyzeReceipt] Client matching failed (non-fatal):', clientErr);
    }

    context.log(
      `[AnalyzeReceipt] vendor="${vendorName}"(${vendorConfidence.toFixed(2)}), ` +
      `amount=${amount}(${amountConfidence.toFixed(2)}), date=${date}(${dateConfidence.toFixed(2)}), ` +
      `type=${assistanceType}, region=${region}, addr="${combinedAddress}"` +
      `${clientMatch ? `, client="${clientMatch.clientName}"(${clientMatch.confidence.toFixed(2)},${clientMatch.matchType})` : ''}`
    );

    return {
      status: 200,
      jsonBody: {
        success: true,
        vendorName: vendorName || null,
        amount: amount,
        date: date,
        assistanceType: assistanceType,
        region: clientMatch?.region || region,
        vendorAddress: combinedAddress || null,
        description: itemDescriptions.length > 0 ? itemDescriptions.join('; ') : null,
        clientMatch: clientMatch,
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
