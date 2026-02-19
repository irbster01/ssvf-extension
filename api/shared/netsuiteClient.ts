import * as crypto from 'crypto';

/**
 * NetSuite REST API client using OAuth 1.0 Token-Based Authentication (TBA).
 * All credentials are read from environment variables — never exposed to the frontend.
 */

interface NetSuiteConfig {
  accountId: string;
  consumerKey: string;
  consumerSecret: string;
  tokenId: string;
  tokenSecret: string;
}

function getConfig(): NetSuiteConfig {
  const accountId = process.env.NETSUITE_ACCOUNT_ID;
  const consumerKey = process.env.NETSUITE_CONSUMER_KEY;
  const consumerSecret = process.env.NETSUITE_CONSUMER_SECRET;
  const tokenId = process.env.NETSUITE_TOKEN_ID;
  const tokenSecret = process.env.NETSUITE_TOKEN_SECRET;

  if (!accountId || !consumerKey || !consumerSecret || !tokenId || !tokenSecret) {
    throw new Error('Missing NetSuite configuration. Ensure all NETSUITE_* env vars are set.');
  }

  return { accountId, consumerKey, consumerSecret, tokenId, tokenSecret };
}

/**
 * Build the base URL for NetSuite REST API (SuiteTalk).
 * Sandbox accounts use the format: {accountId}.suitetalk.api.netsuite.com
 * The account ID with underscores is converted to dashes for the URL.
 */
function getBaseUrl(accountId: string): string {
  const urlAccountId = accountId.toLowerCase().replace(/_/g, '-');
  return `https://${urlAccountId}.suitetalk.api.netsuite.com/services/rest`;
}

/**
 * Percent-encode a string per RFC 5849 (OAuth 1.0).
 */
function percentEncode(str: string): string {
  return encodeURIComponent(str)
    .replace(/!/g, '%21')
    .replace(/\*/g, '%2A')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29');
}

/**
 * Generate OAuth header for a full URL that may contain query parameters.
 * Query params MUST be included in the signature base string per OAuth 1.0 spec.
 */
function generateOAuthHeaderForUrl(
  method: string,
  fullUrl: string,
  config: NetSuiteConfig,
): string {
  const urlObj = new URL(fullUrl);
  const baseUrl = urlObj.origin + urlObj.pathname;

  const nonce = crypto.randomBytes(16).toString('hex');
  const timestamp = Math.floor(Date.now() / 1000).toString();

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: config.consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: 'HMAC-SHA256',
    oauth_timestamp: timestamp,
    oauth_token: config.tokenId,
    oauth_version: '1.0',
  };

  // Merge query params into the signing params
  const allParams: Record<string, string> = { ...oauthParams };
  for (const [k, v] of urlObj.searchParams.entries()) {
    allParams[k] = v;
  }

  const paramString = Object.keys(allParams)
    .sort()
    .map(key => `${percentEncode(key)}=${percentEncode(allParams[key])}`)
    .join('&');

  const baseString = [
    method.toUpperCase(),
    percentEncode(baseUrl),
    percentEncode(paramString),
  ].join('&');

  const signingKey = `${percentEncode(config.consumerSecret)}&${percentEncode(config.tokenSecret)}`;
  const signature = crypto.createHmac('sha256', signingKey).update(baseString).digest('base64');

  oauthParams['oauth_signature'] = signature;

  const realm = config.accountId;
  const headerParams = Object.keys(oauthParams)
    .sort()
    .map(key => `${percentEncode(key)}="${percentEncode(oauthParams[key])}"`)
    .join(', ');

  return `OAuth realm="${realm}", ${headerParams}`;
}

/**
 * Make an authenticated request to the NetSuite REST API.
 */
export async function netsuiteRequest(
  method: string,
  path: string,
  body?: any,
): Promise<{ status: number; data: any; location?: string }> {
  const config = getConfig();
  const baseUrl = getBaseUrl(config.accountId);
  const url = `${baseUrl}${path}`;

  // Use the URL-aware signer so query params are properly included
  const authHeader = generateOAuthHeaderForUrl(method, url, config);

  const headers: Record<string, string> = {
    'Authorization': authHeader,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };

  const options: RequestInit = {
    method,
    headers,
    redirect: 'manual', // Don't follow redirects — we need the Location header
  };

  if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);

  let data: any;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    data = await response.json();
  } else {
    data = await response.text();
  }

  // Capture Location header (NetSuite returns new record URL on 204 Created)
  const location = response.headers.get('location') || undefined;

  return { status: response.status, data, location };
}

/**
 * Run a SuiteQL query against NetSuite.
 */
export async function suiteQL(query: string, limit = 1000, offset = 0): Promise<{ items: any[]; totalResults: number; hasMore: boolean }> {
  const config = getConfig();
  const baseUrl = getBaseUrl(config.accountId);
  const url = `${baseUrl}/query/v1/suiteql?limit=${limit}&offset=${offset}`;

  const authHeader = generateOAuthHeaderForUrl('POST', url, config);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Prefer': 'transient',
    },
    body: JSON.stringify({ q: query }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`SuiteQL failed (${response.status}): ${text.substring(0, 300)}`);
  }

  const data = await response.json();
  return {
    items: data.items || [],
    totalResults: data.totalResults || 0,
    hasMore: data.hasMore || false,
  };
}

/**
 * Vendor record returned from NetSuite.
 */
export interface NetSuiteVendor {
  id: string;
  entityId: string;
  companyName: string;
}

/**
 * Fetch all active vendors from NetSuite (cached per function app instance).
 */
let vendorCache: { vendors: NetSuiteVendor[]; fetchedAt: number } | null = null;
const VENDOR_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

export async function getVendors(): Promise<NetSuiteVendor[]> {
  // Return cached if fresh enough
  if (vendorCache && Date.now() - vendorCache.fetchedAt < VENDOR_CACHE_TTL) {
    return vendorCache.vendors;
  }

  const allVendors: NetSuiteVendor[] = [];
  let offset = 0;
  const pageSize = 1000;
  let hasMore = true;

  while (hasMore) {
    const result = await suiteQL(
      `SELECT id, entityId, companyName FROM vendor WHERE isInactive = 'F' ORDER BY companyName`,
      pageSize,
      offset,
    );
    for (const v of result.items) {
      allVendors.push({
        id: String(v.id),
        entityId: v.entityid || '',
        companyName: v.companyname || v.entityid || '',
      });
    }
    hasMore = result.hasMore;
    offset += pageSize;
  }

  vendorCache = { vendors: allVendors, fetchedAt: Date.now() };
  return allVendors;
}

/**
 * GL Account record returned from NetSuite.
 */
export interface NetSuiteAccount {
  id: string;
  number: string;
  name: string;
}

/**
 * Fetch expense accounts from NetSuite (cached per function app instance).
 * Filters to accounts of type "Expense" that are active.
 */
let accountCache: { accounts: NetSuiteAccount[]; fetchedAt: number } | null = null;
const ACCOUNT_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

export async function getAccounts(): Promise<NetSuiteAccount[]> {
  if (accountCache && Date.now() - accountCache.fetchedAt < ACCOUNT_CACHE_TTL) {
    return accountCache.accounts;
  }

  const allAccounts: NetSuiteAccount[] = [];
  let offset = 0;
  const pageSize = 1000;
  let hasMore = true;

  while (hasMore) {
    const result = await suiteQL(
      `SELECT id, acctnumber, acctname, accttype FROM account WHERE isinactive = 'F' ORDER BY acctnumber`,
      pageSize,
      offset,
    );
    for (const a of result.items) {
      allAccounts.push({
        id: String(a.id),
        number: a.acctnumber || '',
        name: a.acctname || '',
      });
    }
    hasMore = result.hasMore;
    offset += pageSize;
  }

  accountCache = { accounts: allAccounts, fetchedAt: Date.now() };
  return allAccounts;
}

/**
 * Test connectivity by fetching account metadata.
 */
export async function testConnection(): Promise<{ success: boolean; message: string; details?: any }> {
  try {
    // Try to GET the metadata catalog — a lightweight read-only call
    const result = await netsuiteRequest('GET', '/record/v1/metadata-catalog/');
    
    if (result.status === 200) {
      return {
        success: true,
        message: 'Successfully connected to NetSuite sandbox!',
        details: { status: result.status, recordTypes: typeof result.data === 'object' ? 'OK' : result.data },
      };
    } else if (result.status === 401 || result.status === 403) {
      return {
        success: false,
        message: `Authentication failed (${result.status}). Check your OAuth credentials.`,
        details: result.data,
      };
    } else {
      return {
        success: false,
        message: `Unexpected response: ${result.status}`,
        details: result.data,
      };
    }
  } catch (err) {
    return {
      success: false,
      message: `Connection error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Build a NetSuite Purchase Order payload from our submission data.
 *
 * Uses the "expense" sublist (not "item") so the GL account can be set directly.
 * NetSuite REST API ignores the `account` field on item-sublist lines for NonInvtPart items,
 * so the expense sublist is the only reliable way to control the GL account.
 */
export interface POInput {
  vendorName: string;
  vendorId?: string;
  vendorAccount: string;
  clientId: string;
  clientName: string;
  region: string;
  programCategory: string;
  amount: number;
  memo: string;
  tfaNotes: string;
  // Custom body fields for the SSVF PO form
  clientTypeId?: string;              // custbody8: 1=Rapid Rehousing, 2=Homeless Prevention (NetSuite's internal list)
  clientCategoryId?: string;           // custbody13: 1=Homeless Prevention (Cat1), 2=Rapid Rehousing (Cat2)
  financialAssistanceTypeId?: string; // custbody11: 1-10 list values
  assistanceMonthId?: string;         // custbody12: 1=January … 12=December
  lineItems: Array<{
    itemId: string;         // Kept for reference / item name in description
    itemName?: string;      // Human-readable item name (e.g. "Rental Assistance")
    departmentId: string;
    classId: string;
    accountId?: string;     // GL expense account (now used on expense sublist)
    description: string;
    quantity: number;
    rate: number;
    amount: number;
  }>;
}

export function buildPurchaseOrderPayload(input: POInput) {
  return {
    // Custom form: "VOANLA - SSVF Employee Purchase Request" (id 150)
    customForm: { id: '150' },
    // Use vendor internal ID when available (required for live PO creation)
    entity: input.vendorId ? { id: input.vendorId } : { name: input.vendorName },
    // Subsidiary: "Volunteers of America North Louisiana" (id 14)
    subsidiary: { id: '14' },
    memo: `SSVF TFA - ${input.region} - ${input.programCategory} | Client: ${input.clientName} (${input.clientId})${input.tfaNotes ? ' | ' + input.tfaNotes : ''}`,    // Header memo uses TFA notes from submission
    // Custom body fields for SSVF Employee Purchase Request form
    custbody10: input.clientName || '',       // Client Name
    custbody7: input.clientId ? parseInt(input.clientId, 10) || 0 : 0,  // Client ID (LSNDC) - Integer field, displayed as "CLIENT ID" on SSVF form
    custbody9: input.clientId ? parseInt(input.clientId, 10) || 0 : 0,  // Client ID - Integer field (backup)
    ...(input.clientTypeId ? { custbody8: { id: input.clientTypeId } } : {}),              // Client Type (1=RRH, 2=HP)
    ...(input.clientCategoryId ? { custbody13: { id: input.clientCategoryId } } : {}),     // Client Category SSVF (1=HP/Cat1, 2=RRH/Cat2)
    ...(input.financialAssistanceTypeId ? { custbody11: { id: input.financialAssistanceTypeId } } : {}), // Financial Assistance Type
    ...(input.assistanceMonthId ? { custbody12: { id: input.assistanceMonthId } } : {}),   // Assistance Month
    custbody10_2: { id: '1' },                // Approval Routing Program: VETS
    // Use expense sublist so the GL account is settable directly
    expense: {
      items: input.lineItems.map(li => {
        // Build memo: include item name + optional PO modal memo
        const lineMemo = input.memo
          ? `${li.description} — ${input.memo}`
          : li.description;
        return {
          account: { id: li.accountId || '312' },  // GL account (default: Room & Board)
          amount: li.amount,
          memo: lineMemo,
          department: { id: li.departmentId },
          class: { id: li.classId },
        };
      }),
    },
  };
}

/**
 * Create a Purchase Order in NetSuite (or dry-run to validate payload).
 */
export async function createPurchaseOrder(
  input: POInput,
  dryRun: boolean = true,
): Promise<{ success: boolean; message: string; payload?: any; response?: any }> {
  const payload = buildPurchaseOrderPayload(input);

  if (dryRun) {
    return {
      success: true,
      message: 'Dry run — PO payload generated but NOT sent to NetSuite.',
      payload,
    };
  }

  try {
    const result = await netsuiteRequest('POST', '/record/v1/purchaseOrder', payload);

    if (result.status === 204 || result.status === 200 || result.status === 201) {
      // Extract PO internal ID from Location header (e.g. /record/v1/purchaseorder/12345)
      let internalId: string | undefined;
      if (result.location) {
        const match = result.location.match(/\/purchaseorder\/(\d+)/i);
        if (match) internalId = match[1];
      }
      if (!internalId && result.data) {
        if (result.data.id) internalId = String(result.data.id);
        else if (result.data.internalId) internalId = String(result.data.internalId);
      }

      // Fetch the actual PO number (tranId) via SuiteQL — avoids triggering record scripts
      let poNumber: string | undefined;
      if (internalId) {
        try {
          const ql = await suiteQL(`SELECT tranId FROM transaction WHERE id = ${internalId}`, 1);
          if (ql.items.length > 0 && ql.items[0].tranid) {
            poNumber = String(ql.items[0].tranid);
          }
        } catch (fetchErr) {
          console.warn('[createPurchaseOrder] SuiteQL tranId lookup failed:', fetchErr);
        }
      }

      const displayId = poNumber || internalId;
      return {
        success: true,
        message: `Purchase Order created in NetSuite!${displayId ? ` (PO# ${displayId})` : ''}`,
        payload,
        response: { status: result.status, data: result.data, location: result.location, poId: displayId, internalId },
      };
    } else {
      return {
        success: false,
        message: `NetSuite returned ${result.status}`,
        payload,
        response: { status: result.status, data: result.data },
      };
    }
  } catch (err) {
    return {
      success: false,
      message: `Error creating PO: ${err instanceof Error ? err.message : String(err)}`,
      payload,
    };
  }
}

// ============ FILE CABINET / ATTACHMENT FUNCTIONS ============

/**
 * Find or create a folder in NetSuite's File Cabinet for SSVF TFA attachments.
 * Caches the folder ID for the lifetime of the function app instance.
 */
let tfaFolderIdCache: string | null = null;

export async function ensureTFAFolder(): Promise<string> {
  if (tfaFolderIdCache) return tfaFolderIdCache;

  // Try to find existing folder via SuiteQL
  try {
    const result = await suiteQL(
      `SELECT id FROM mediaitemfolder WHERE name = 'SSVF TFA Attachments'`,
      1,
    );
    if (result.items.length > 0) {
      tfaFolderIdCache = String(result.items[0].id);
      return tfaFolderIdCache;
    }
  } catch (err) {
    console.warn('[ensureTFAFolder] SuiteQL lookup failed, will create folder:', err);
  }

  // Folder doesn't exist — create it
  const createResult = await netsuiteRequest('POST', '/record/v1/folder', {
    name: 'SSVF TFA Attachments',
  });

  if (createResult.status === 204 || createResult.status === 200 || createResult.status === 201) {
    // Extract folder ID from Location header
    let folderId: string | undefined;
    if (createResult.location) {
      const match = createResult.location.match(/\/folder\/(\d+)/i);
      if (match) folderId = match[1];
    }
    if (!folderId && createResult.data?.id) {
      folderId = String(createResult.data.id);
    }
    if (folderId) {
      tfaFolderIdCache = folderId;
      return tfaFolderIdCache;
    }
  }

  throw new Error(`Failed to create SSVF TFA Attachments folder: ${createResult.status}`);
}

/**
 * Upload a file to the NetSuite File Cabinet.
 * Returns the internal file ID.
 */
export async function uploadFileToNetSuite(
  fileName: string,
  base64Content: string,
  folderId: string,
  description?: string,
): Promise<string> {
  const result = await netsuiteRequest('POST', '/record/v1/file', {
    name: fileName,
    folder: { id: folderId },
    content: base64Content,
    ...(description ? { description } : {}),
  });

  if (result.status === 204 || result.status === 200 || result.status === 201) {
    let fileId: string | undefined;
    if (result.location) {
      const match = result.location.match(/\/file\/(\d+)/i);
      if (match) fileId = match[1];
    }
    if (!fileId && result.data?.id) {
      fileId = String(result.data.id);
    }
    if (fileId) return fileId;
  }

  throw new Error(`Failed to upload file to NetSuite: ${result.status} ${JSON.stringify(result.data).substring(0, 300)}`);
}

/**
 * Attach a File Cabinet file to a Purchase Order record in NetSuite.
 */
export async function attachFileToPO(fileId: string, poInternalId: string): Promise<void> {
  const result = await netsuiteRequest(
    'POST',
    `/record/v1/purchaseOrder/${poInternalId}/!transform/attach`,
    {
      record: {
        type: 'file',
        id: fileId,
      },
    },
  );

  // Accept 204, 200, 201 as success
  if (result.status !== 204 && result.status !== 200 && result.status !== 201) {
    throw new Error(`Failed to attach file ${fileId} to PO ${poInternalId}: ${result.status} ${JSON.stringify(result.data).substring(0, 300)}`);
  }
}

/**
 * Upload files to NetSuite File Cabinet and attach them to a PO.
 * Returns a summary of successes/failures (non-throwing — PO is already created at this point).
 */
export async function uploadAndAttachFiles(
  poInternalId: string,
  poNumber: string | undefined,
  files: Array<{ fileName: string; buffer: Buffer; contentType: string }>,
): Promise<{ attached: number; failed: number; errors: string[] }> {
  const errors: string[] = [];
  let attached = 0;

  // Ensure the target folder exists
  let folderId: string;
  try {
    folderId = await ensureTFAFolder();
  } catch (err) {
    return { attached: 0, failed: files.length, errors: [`Folder creation failed: ${err instanceof Error ? err.message : String(err)}`] };
  }

  for (const file of files) {
    try {
      const base64 = file.buffer.toString('base64');
      const nsFileName = poNumber
        ? `PO_${poNumber}_${file.fileName}`
        : `TFA_${poInternalId}_${file.fileName}`;

      const fileId = await uploadFileToNetSuite(
        nsFileName,
        base64,
        folderId,
        `SSVF TFA attachment for PO ${poNumber || poInternalId}`,
      );

      await attachFileToPO(fileId, poInternalId);
      attached++;
    } catch (err) {
      const msg = `Failed ${file.fileName}: ${err instanceof Error ? err.message : String(err)}`;
      errors.push(msg);
      console.warn('[uploadAndAttachFiles]', msg);
    }
  }

  return { attached, failed: files.length - attached, errors };
}
