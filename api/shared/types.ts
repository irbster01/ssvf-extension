export interface CapturePayload {
  user_id: string;
  source_url: string;
  captured_at_utc: string;
  service_type?: string;
  form_data: Record<string, any>;
}

export interface EnrichedCapture extends CapturePayload {
  received_at_utc: string;
  // Extracted fields for reporting/accounting
  client_id?: string;       // Wellsky client ID - required for linking to client record
  client_name?: string;     // Client display name
  vendor?: string;
  vendor_account?: string;
  service_amount?: number;
}
