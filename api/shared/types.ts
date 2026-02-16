export interface CapturePayload {
  user_id: string;
  source_url: string;
  captured_at_utc: string;
  service_type?: string;
  form_data: Record<string, any>;
}
