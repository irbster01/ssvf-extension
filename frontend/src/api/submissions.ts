import { Submission, AttachmentMeta, Message, UnreadCountResponse } from '../types';

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
  tfaDate: string;          // mm/dd/yyyy date of the TFA
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
      tfa_date: tfa.tfaDate || undefined,
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

export interface NetSuiteAccount {
  id: string;
  number: string;
  name: string;
}

export async function fetchNetSuiteAccounts(token: string): Promise<NetSuiteAccount[]> {
  const response = await fetch(`${API_BASE}/netsuite/accounts`, {
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch accounts: ${response.status}`);
  }

  const data = await response.json();
  return data.accounts || [];
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
  tfaNotes: string;
  clientTypeId?: string;
  clientCategoryId?: string;
  financialAssistanceTypeId?: string;
  assistanceMonthId?: string;
  lineItems: Array<{
    itemId: string;
    departmentId: string;
    classId: string;
    accountId?: string;
    description: string;
    quantity: number;
    rate: number;
    amount: number;
  }>;
  attachmentBlobNames?: string[];
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

// ============ Internal Messaging ============

export async function fetchMessages(token: string, submissionId: string): Promise<Message[]> {
  const response = await fetch(`${API_BASE}/submissions/${submissionId}/messages`, {
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch messages: ${response.status}`);
  }

  return response.json();
}

export async function sendMessage(
  token: string,
  submissionId: string,
  text: string,
  serviceType: string = 'TFA'
): Promise<Message> {
  const response = await fetch(`${API_BASE}/submissions/${submissionId}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text, service_type: serviceType }),
  });

  if (!response.ok) {
    throw new Error(`Failed to send message: ${response.status}`);
  }

  return response.json();
}

export async function markThreadRead(
  token: string,
  submissionId: string
): Promise<{ success: boolean; markedCount: number }> {
  const response = await fetch(`${API_BASE}/messages/read-thread`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ submissionId }),
  });

  if (!response.ok) {
    throw new Error(`Failed to mark thread read: ${response.status}`);
  }

  return response.json();
}

export async function fetchUnreadCount(token: string): Promise<UnreadCountResponse> {
  const response = await fetch(`${API_BASE}/messages/unread-count`, {
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch unread count: ${response.status}`);
  }

  return response.json();
}

export async function negotiateSignalR(token: string): Promise<{
  url: string | null;
  accessToken: string | null;
  userId: string;
  configured: boolean;
}> {
  const response = await fetch(`${API_BASE}/signalr/negotiate`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to negotiate SignalR: ${response.status}`);
  }

  return response.json();
}
