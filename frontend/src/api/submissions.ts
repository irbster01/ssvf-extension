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
