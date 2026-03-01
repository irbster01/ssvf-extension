import { InvocationContext } from '@azure/functions';

/**
 * Structured audit logging for security-relevant events.
 * Outputs structured JSON that Application Insights can index and query.
 * 
 * When Application Insights is connected (via APPLICATIONINSIGHTS_CONNECTION_STRING),
 * these structured logs are automatically ingested and queryable via KQL.
 */

export type AuditEventType =
  | 'AUTH_SUCCESS'
  | 'AUTH_FAILURE'
  | 'RATE_LIMIT_EXCEEDED'
  | 'RATE_LIMIT_WARNING'
  | 'PAYLOAD_VALIDATION_FAILURE'
  | 'CORS_VIOLATION'
  | 'CAPTURE_CREATED'
  | 'SUBMISSION_UPDATED'
  | 'PO_CREATED'
  | 'MESSAGE_SENT'
  | 'ATTACHMENT_UPLOADED'
  | 'EXPORT_REQUESTED';

export interface AuditEvent {
  event: AuditEventType;
  userId?: string;
  email?: string;
  ipAddress?: string;
  origin?: string;
  endpoint: string;
  method: string;
  timestamp: string;
  success: boolean;
  details?: Record<string, unknown>;
}

/**
 * Log a structured audit event via the Azure Functions context logger.
 * Application Insights automatically picks up structured log data.
 */
export function logAuditEvent(context: InvocationContext, event: AuditEvent): void {
  const logEntry = {
    ...event,
    auditLog: true, // Marker for KQL filtering: customDimensions.auditLog == true
  };

  if (event.success) {
    context.log('[AUDIT]', JSON.stringify(logEntry));
  } else {
    context.warn('[AUDIT]', JSON.stringify(logEntry));
  }
}

/**
 * Helper: extract client IP from Azure Functions request headers.
 * Azure passes the real client IP in x-forwarded-for or x-client-ip.
 */
export function getClientIp(headers: { get(name: string): string | null }): string {
  return (
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    headers.get('x-client-ip') ||
    headers.get('x-real-ip') ||
    'unknown'
  );
}

/**
 * Helper: create a base audit event from a request.
 */
export function createBaseAuditEvent(
  request: { headers: { get(name: string): string | null }; method: string; url: string },
  endpoint: string
): Pick<AuditEvent, 'ipAddress' | 'origin' | 'endpoint' | 'method' | 'timestamp'> {
  return {
    ipAddress: getClientIp(request.headers),
    origin: request.headers.get('origin') || undefined,
    endpoint,
    method: request.method,
    timestamp: new Date().toISOString(),
  };
}
