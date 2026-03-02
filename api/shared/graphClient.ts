import { ClientSecretCredential } from '@azure/identity';
import { Client } from '@microsoft/microsoft-graph-client';
import { TokenCredentialAuthenticationProvider } from '@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials';

// ──────────────────────────────────────────────────
//  Shared mailbox used for all outbound notifications
// ──────────────────────────────────────────────────
export const NOTIFY_MAILBOX = () => process.env.NOTIFICATION_FROM_EMAIL || '';
const DASHBOARD_URL = 'https://ssvf.northla.app';

// Standardised subject prefix — makes Outlook rules / sorting trivial
const SUBJECT_PREFIX = '[SSVF-TFA]';

// ──────────────────────────────────────────────────
//  Graph client singleton
// ──────────────────────────────────────────────────
let graphClient: Client | null = null;

function getGraphClient(): Client {
  if (graphClient) return graphClient;

  const tenantId = process.env.GRAPH_TENANT_ID || process.env.AZURE_TENANT_ID || '38c1626e-b75d-40a6-b21b-0aae1191c730';
  const clientId = process.env.GRAPH_CLIENT_ID || '848ba96c-9617-48c7-b8fd-e22c4388fab6';
  const clientSecret = process.env.GRAPH_CLIENT_SECRET;

  if (!clientSecret) {
    throw new Error('GRAPH_CLIENT_SECRET environment variable is required for email notifications');
  }

  const credential = new ClientSecretCredential(tenantId, clientId, clientSecret);

  const authProvider = new TokenCredentialAuthenticationProvider(credential, {
    scopes: ['https://graph.microsoft.com/.default'],
  });

  graphClient = Client.initWithMiddleware({ authProvider });
  return graphClient;
}

// ──────────────────────────────────────────────────
//  Low-level send
// ────────────────────────────────────────────────── 
/**
 * Send an email notification via Microsoft Graph using the shared mailbox.
 * Requires Mail.Send application permission and admin consent.
 */
export async function sendEmail(
  to: string,
  subject: string,
  htmlBody: string
): Promise<void> {
  const fromEmail = NOTIFY_MAILBOX();

  if (!fromEmail) {
    console.warn('[GraphClient] NOTIFICATION_FROM_EMAIL not configured — skipping email send');
    return;
  }

  const client = getGraphClient();

  const message = {
    subject,
    body: {
      contentType: 'HTML',
      content: htmlBody,
    },
    toRecipients: [
      {
        emailAddress: { address: to },
      },
    ],
  };

  try {
    await client.api(`/users/${fromEmail}/sendMail`).post({ message });
    console.log(`[GraphClient] ✉ Email sent → ${to}: "${subject}"`);
  } catch (error: any) {
    console.error('[GraphClient] Failed to send email:', error.message);
    // Don't throw — email failure shouldn't block the primary operation
  }
}

/**
 * Send a notification email to the shared SSVF notifications mailbox.
 */
export async function sendNotifyEmail(subject: string, htmlBody: string): Promise<void> {
  const mailbox = NOTIFY_MAILBOX();
  if (!mailbox) return;
  await sendEmail(mailbox, subject, htmlBody);
}

// ──────────────────────────────────────────────────
//  Reusable HTML wrapper
// ──────────────────────────────────────────────────
function emailWrapper(heading: string, accentColor: string, bodyHtml: string): string {
  return `
    <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 560px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, ${accentColor} 0%, #764ba2 100%); padding: 20px; border-radius: 8px 8px 0 0; color: white;">
        <h2 style="margin: 0; font-size: 18px;">${heading}</h2>
      </div>
      <div style="background: #ffffff; border: 1px solid #e5e7eb; border-top: none; padding: 20px; border-radius: 0 0 8px 8px;">
        ${bodyHtml}
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 16px 0;">
        <p style="margin: 0; color: #9ca3af; font-size: 11px;">
          This is an automated notification from the SSVF TFA system. Do not reply to this email.
        </p>
      </div>
    </div>
  `;
}

function detailRow(label: string, value: string | undefined): string {
  if (!value) return '';
  return `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:13px;">${label}</td><td style="padding:4px 0;font-size:13px;color:#1f2937;"><strong>${value}</strong></td></tr>`;
}

function detailsTable(rows: string): string {
  return `<table style="border-collapse:collapse;margin:12px 0;">${rows}</table>`;
}

function dashboardLink(text?: string): string {
  return `<p style="margin: 0 0 16px; color: #6b7280; font-size: 13px;">
    View details on the <a href="${DASHBOARD_URL}" style="color: #667eea;">${text || 'SSVF Dashboard'}</a>.
  </p>`;
}

// ──────────────────────────────────────────────────
//  1️⃣  NEW SUBMISSION
// ──────────────────────────────────────────────────
export function buildNewSubmissionEmail(opts: {
  submitterEmail: string;
  clientName?: string;
  serviceType?: string;
  region?: string;
  amount?: number;
  capturedAt?: string;
}): { subject: string; html: string } {
  const clientLabel = opts.clientName || 'Unknown Client';
  const subject = `${SUBJECT_PREFIX} New Submission — ${clientLabel}`;

  const rows =
    detailRow('Client', clientLabel) +
    detailRow('Submitted by', opts.submitterEmail) +
    detailRow('Service type', opts.serviceType || 'TFA') +
    detailRow('Region', opts.region) +
    detailRow('Amount', opts.amount != null ? `$${opts.amount.toFixed(2)}` : undefined) +
    detailRow('Captured', opts.capturedAt);

  const html = emailWrapper('SSVF TFA — New Submission', '#667eea', `
    <p style="margin: 0 0 12px; color: #374151; font-size: 14px;">
      A new submission has been received and is ready for review.
    </p>
    ${detailsTable(rows)}
    ${dashboardLink()}
  `);

  return { subject, html };
}

// ──────────────────────────────────────────────────
//  2️⃣  CORRECTION NEEDED (sent to submitter)
// ──────────────────────────────────────────────────
export function buildCorrectionNeededEmail(opts: {
  clientName?: string;
  requestedBy: string;
  message?: string;
  submissionDate?: string;
}): { subject: string; html: string } {
  const clientLabel = opts.clientName || 'a submission';
  const subject = `${SUBJECT_PREFIX} Correction Needed — ${clientLabel}`;

  const messageBlock = opts.message
    ? `<div style="background: #fef3c7; border-left: 3px solid #f59e0b; padding: 12px 16px; border-radius: 4px; margin: 12px 0; font-size: 14px; color: #92400e;">
        ${opts.message.replace(/\n/g, '<br>')}
      </div>`
    : '';

  const html = emailWrapper('SSVF TFA — Correction Needed', '#f59e0b', `
    <p style="margin: 0 0 12px; color: #374151; font-size: 14px;">
      Your submission for <strong>${clientLabel}</strong>${opts.submissionDate ? ` (captured ${opts.submissionDate})` : ''} has been <strong style="color:#b45309;">sent back for corrections</strong>.
    </p>
    ${messageBlock}
    <p style="margin: 0 0 12px; color: #374151; font-size: 14px;">
      Requested by: <strong>${opts.requestedBy}</strong>
    </p>
    <p style="margin: 0 0 16px; color: #6b7280; font-size: 13px;">
      Please review and fix via the <strong>SSVF Extension</strong> (Submissions tab) or the
      <a href="${DASHBOARD_URL}" style="color: #667eea;">SSVF Dashboard</a>.
    </p>
  `);

  return { subject, html };
}

// ──────────────────────────────────────────────────
//  3️⃣  CORRECTION COMPLETED (sent to ssvf-notify)
// ──────────────────────────────────────────────────
export function buildCorrectionCompletedEmail(opts: {
  clientName?: string;
  correctedBy: string;
  submissionDate?: string;
}): { subject: string; html: string } {
  const clientLabel = opts.clientName || 'a submission';
  const subject = `${SUBJECT_PREFIX} Correction Completed — ${clientLabel}`;

  const html = emailWrapper('SSVF TFA — Correction Completed', '#10b981', `
    <p style="margin: 0 0 12px; color: #374151; font-size: 14px;">
      Corrections for <strong>${clientLabel}</strong>${opts.submissionDate ? ` (captured ${opts.submissionDate})` : ''} have been completed and the submission is back <strong style="color:#059669;">In Review</strong>.
    </p>
    <p style="margin: 0 0 12px; color: #374151; font-size: 14px;">
      Corrected by: <strong>${opts.correctedBy}</strong>
    </p>
    ${dashboardLink()}
  `);

  return { subject, html };
}

// ──────────────────────────────────────────────────
//  4️⃣  NEW MESSAGE (existing, now standardised)
// ──────────────────────────────────────────────────
export function buildMessageNotificationEmail(opts: {
  senderName: string;
  messageText: string;
  clientName?: string;
  submissionDate?: string;
  dashboardUrl?: string;
}): { subject: string; html: string } {
  const clientLabel = opts.clientName || 'a submission';
  const subject = `${SUBJECT_PREFIX} New Message — ${clientLabel}`;

  const html = emailWrapper('SSVF TFA — New Message', '#667eea', `
    <p style="margin: 0 0 12px; color: #374151; font-size: 14px;">
      <strong>${opts.senderName}</strong> sent a message regarding <strong>${clientLabel}</strong>${opts.submissionDate ? ` (captured ${opts.submissionDate})` : ''}:
    </p>
    <div style="background: #f3f4f6; border-left: 3px solid #667eea; padding: 12px 16px; border-radius: 4px; margin: 0 0 16px; font-size: 14px; color: #1f2937;">
      ${opts.messageText.replace(/\n/g, '<br>')}
    </div>
    <p style="margin: 0 0 16px; color: #6b7280; font-size: 13px;">
      Please review and reply via the <strong>SSVF Extension</strong> (Submissions tab) or the
      <a href="${opts.dashboardUrl || DASHBOARD_URL}" style="color: #667eea;">SSVF Dashboard</a>.
    </p>
  `);

  return { subject, html };
}
