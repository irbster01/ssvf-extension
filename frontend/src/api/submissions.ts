import { Submission, AttachmentMeta } from '../types';

const API_BASE = import.meta.env.PROD 
  ? 'https://ssvf-capture-api.azurewebsites.net/api'
  : '/api';

export async function fetchSubmissions(token: string): Promise<Submission[]> {
  const response = await fetch(`${API_BASE}/submissions`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch submissions: ${response.status}`);
  }

  return response.json();
}

export async function updateSubmission(
  token: string,
  id: string,
  serviceType: string,
  updates: Partial<Submission>
): Promise<Submission> {
  const response = await fetch(`${API_BASE}/submissions/${id}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ...updates, service_type: serviceType }),
  });

  if (!response.ok) {
    throw new Error(`Failed to update submission: ${response.status}`);
  }

  return response.json();
}

export async function uploadAttachment(
  token: string,
  submissionId: string,
  serviceType: string,
  file: File
): Promise<AttachmentMeta> {
  const base64 = await fileToBase64(file);
  
  const response = await fetch(`${API_BASE}/submissions/${submissionId}/attachments`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      fileName: file.name,
      contentType: file.type || 'application/octet-stream',
      data: base64,
      serviceType,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to upload attachment: ${response.status}`);
  }

  return response.json();
}

export async function getAttachmentDownloadUrl(
  token: string,
  blobName: string
): Promise<string> {
  const response = await fetch(`${API_BASE}/attachments/download?blob=${encodeURIComponent(blobName)}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to get download URL: ${response.status}`);
  }

  const data = await response.json();
  return data.url;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1]);
    };
    reader.onerror = reject;
  });
}

export interface TFASubmission {
  clientId: string;
  clientName: string;
  vendor: string;
  vendorId: string;        // NetSuite internal vendor ID
  amount: string;
  region: string;
  programCategory: string;
  assistanceType: string;
  notes: string;
}

export async function submitCapture(token: string, tfa: TFASubmission): Promise<{ id: string }> {
  const payload = {
    user_id: 'unknown',
    source_url: 'swa-dashboard',
    captured_at_utc: new Date().toISOString(),
    form_data: {
      client_id: tfa.clientId,
      client_name: tfa.clientName,
      vendor: tfa.vendor,
      vendor_id: tfa.vendorId || undefined,
      service_cost_amount: tfa.amount,
      region: tfa.region,
      program_category: tfa.programCategory,
      assistance_type: tfa.assistanceType,
      notes: tfa.notes,
      manual_entry: true,
    },
  };

  const response = await fetch(`${API_BASE}/captures`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Failed to submit TFA: ${response.status}`);
  }

  return response.json();
}

// ============ NetSuite Integration ============

export interface NetSuiteVendor {
  id: string;
  entityId: string;
  companyName: string;
}

export async function fetchNetSuiteVendors(token: string): Promise<NetSuiteVendor[]> {
  const response = await fetch(`${API_BASE}/netsuite/vendors`, {
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch vendors: ${response.status}`);
  }

  const data = await response.json();
  return data.vendors || [];
}

export interface PurchaseOrderInput {
  submissionId: string;
  vendorName: string;
  vendorId?: string;
  vendorAccount: string;
  clientId: string;
  clientName: string;
  region: string;
  programCategory: string;
  amount: number;
  memo: string;
  clientTypeId?: string;
  financialAssistanceTypeId?: string;
  assistanceMonthId?: string;
  lineItems: Array<{
    itemId: string;
    departmentId: string;
    classId: string;
    description: string;
    quantity: number;
    rate: number;
    amount: number;
  }>;
  dryRun?: boolean;
}

export async function testNetSuiteConnection(token: string): Promise<{ success: boolean; message: string; details?: any }> {
  const response = await fetch(`${API_BASE}/netsuite/test`, {
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  return response.json();
}

export async function createNetSuitePO(
  token: string,
  input: PurchaseOrderInput,
): Promise<{ success: boolean; message: string; payload?: any; response?: any }> {
  const response = await fetch(`${API_BASE}/netsuite/purchase-order`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  return response.json();
}
