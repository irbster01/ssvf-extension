export type SubmissionStatus = 'New' | 'Corrections' | 'In Review' | 'Submitted';

export interface AttachmentMeta {
  blobName: string;
  fileName: string;
  contentType: string;
  size: number;
  uploadedAt: string;
  uploadedBy?: string;
}

export interface Submission {
  id: string;
  user_id: string;
  source_url: string;
  captured_at_utc: string;
  received_at_utc: string;
  service_type: string;
  form_data: Record<string, unknown>;
  // Key fields for accounting
  client_id?: string;
  client_name?: string;
  vendor?: string;
  vendor_id?: string;       // NetSuite internal vendor ID
  vendor_account?: string;
  service_amount?: number;
  // SSVF program fields
  region?: 'Shreveport' | 'Monroe' | 'Arkansas';
  program_category?: 'Homeless Prevention' | 'Rapid Rehousing';
  // TFA date (manually entered)
  tfa_date?: string;
  // Purchase Order
  po_number?: string;
  // Workflow status
  status?: SubmissionStatus;
  notes?: string;
  updated_by?: string;
  updated_at?: string;
  // Documented / entered into ServicePoint or LSNDC
  entered_in_system?: boolean;
  entered_in_system_by?: string;
  entered_in_system_at?: string;
  // Attachments
  attachments?: AttachmentMeta[];
}

// ============ Internal Messaging ============

export interface Message {
  id: string;
  submissionId: string;
  service_type: string;
  text: string;
  sentBy: string;
  sentByName?: string;
  sentAt: string;
  readBy: string[];
}

export interface UnreadCountResponse {
  totalUnread: number;
  perSubmission: Record<string, number>;
}
