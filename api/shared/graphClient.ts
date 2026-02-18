import { ClientSecretCredential } from '@azure/identity';
import { Client } from '@microsoft/microsoft-graph-client';
import { TokenCredentialAuthenticationProvider } from '@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials';

// Singleton Graph client
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

/**
 * Send an email notification via Microsoft Graph using a shared mailbox or service account.
 * Requires Mail.Send application permission and admin consent.
 */
export async function sendEmail(
  to: string,
  subject: string,
  htmlBody: string
): Promise<void> {
  const fromEmail = process.env.NOTIFICATION_FROM_EMAIL;

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
    console.log(`[GraphClient] Email sent to ${to}: "${subject}"`);
  } catch (error: any) {
    console.error(`[GraphClient] Failed to send email to ${to}:`, error.message);
    // Don't throw — email failure shouldn't block the message from being saved
  }
}

/**
 * Build the notification email HTML for a new message on a submission.
 */
export function buildMessageNotificationEmail(opts: {
  senderName: string;
  messageText: string;
  clientName?: string;
  submissionDate?: string;
  dashboardUrl?: string;
}): { subject: string; html: string } {
  const clientLabel = opts.clientName || 'a submission';
  const subject = `Action needed: SSVF submission for ${clientLabel}`;

  const html = `
    <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 560px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px; border-radius: 8px 8px 0 0; color: white;">
        <h2 style="margin: 0; font-size: 18px;">SSVF TFA — Message</h2>
      </div>
      <div style="background: #ffffff; border: 1px solid #e5e7eb; border-top: none; padding: 20px; border-radius: 0 0 8px 8px;">
        <p style="margin: 0 0 12px; color: #374151; font-size: 14px;">
          <strong>${opts.senderName}</strong> sent a message regarding <strong>${clientLabel}</strong>${opts.submissionDate ? ` (captured ${opts.submissionDate})` : ''}:
        </p>
        <div style="background: #f3f4f6; border-left: 3px solid #667eea; padding: 12px 16px; border-radius: 4px; margin: 0 0 16px; font-size: 14px; color: #1f2937;">
          ${opts.messageText.replace(/\n/g, '<br>')}
        </div>
        <p style="margin: 0 0 16px; color: #6b7280; font-size: 13px;">
          Please review and reply via the <strong>SSVF Extension</strong> (Submissions tab) or the
          <a href="${opts.dashboardUrl || 'https://ssvf.northla.app'}" style="color: #667eea;">SSVF Dashboard</a>.
        </p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 16px 0;">
        <p style="margin: 0; color: #9ca3af; font-size: 11px;">
          This is an automated notification from the SSVF TFA system. Do not reply to this email.
        </p>
      </div>
    </div>
  `;

  return { subject, html };
}
