export interface CapturePayload {
  user_id: string;
  source_url: string;
  captured_at_utc: string;
  service_type?: string;
  form_data: Record<string, any>;
}

// ============ Internal Messaging ============

export interface Message {
  id: string;
  submissionId: string;
  service_type: string;
  text: string;
  sentBy: string;       // email of sender
  sentByName?: string;  // display name of sender
  sentAt: string;       // ISO string
  readBy: string[];     // emails of users who have read this message
}

export interface MessagePayload {
  text: string;
  service_type: string;
}
