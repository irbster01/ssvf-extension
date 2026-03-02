/**
 * Tests for graphClient email notification module.
 *
 * Covers:
 *  - Email template builders (subjects, HTML content, optional fields)
 *  - sendEmail / sendNotifyEmail plumbing (mock Graph API)
 *  - Edge cases (missing env vars, Graph errors)
 */

// ── Mock the Graph SDK and Azure Identity before importing ──
const mockPost = jest.fn().mockResolvedValue(undefined);
const mockApi = jest.fn(() => ({ post: mockPost }));
const mockInitWithMiddleware = jest.fn(() => ({ api: mockApi }));

jest.mock('@microsoft/microsoft-graph-client', () => ({
  Client: { initWithMiddleware: mockInitWithMiddleware },
}));

jest.mock('@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials', () => ({
  TokenCredentialAuthenticationProvider: jest.fn(),
}));

jest.mock('@azure/identity', () => ({
  ClientSecretCredential: jest.fn(),
}));

// Set env vars BEFORE importing — graphClient lazy-inits on first sendEmail
process.env.GRAPH_CLIENT_SECRET = 'test-secret';
process.env.NOTIFICATION_FROM_EMAIL = 'ssvf-notify@voanorthla.org';

import {
  sendEmail,
  sendNotifyEmail,
  buildNewSubmissionEmail,
  buildCorrectionNeededEmail,
  buildCorrectionCompletedEmail,
  buildMessageNotificationEmail,
} from '../graphClient';

// ──────────────────────────────────────────────────
//  Template builder tests
// ──────────────────────────────────────────────────
describe('graphClient – email template builders', () => {

  // ── New Submission ──
  describe('buildNewSubmissionEmail', () => {
    it('has standardised subject prefix and client name', () => {
      const { subject } = buildNewSubmissionEmail({
        submitterEmail: 'worker@voanorthla.org',
        clientName: 'John Doe',
      });
      expect(subject).toBe('[SSVF-TFA] New Submission — John Doe');
    });

    it('falls back to "Unknown Client" when clientName is missing', () => {
      const { subject } = buildNewSubmissionEmail({
        submitterEmail: 'worker@voanorthla.org',
      });
      expect(subject).toContain('Unknown Client');
    });

    it('includes submitter email in HTML body', () => {
      const { html } = buildNewSubmissionEmail({
        submitterEmail: 'worker@voanorthla.org',
        clientName: 'Jane Smith',
      });
      expect(html).toContain('worker@voanorthla.org');
    });

    it('includes optional fields when provided', () => {
      const { html } = buildNewSubmissionEmail({
        submitterEmail: 'w@test.org',
        clientName: 'Test',
        serviceType: 'TFA',
        region: 'Monroe',
        amount: 450,
        capturedAt: '2026-03-01T12:00:00Z',
      });
      expect(html).toContain('TFA');
      expect(html).toContain('Monroe');
      expect(html).toContain('$450.00');
      expect(html).toContain('2026-03-01');
    });

    it('omits optional fields when not provided', () => {
      const { html } = buildNewSubmissionEmail({
        submitterEmail: 'w@test.org',
      });
      // Region row should not appear
      expect(html).not.toContain('Monroe');
      expect(html).not.toContain('$');
    });

    it('includes the do-not-reply footer', () => {
      const { html } = buildNewSubmissionEmail({ submitterEmail: 'x@test.org' });
      expect(html).toContain('Do not reply to this email');
    });

    it('includes dashboard link', () => {
      const { html } = buildNewSubmissionEmail({ submitterEmail: 'x@test.org' });
      expect(html).toContain('https://ssvf.northla.app');
    });
  });

  // ── Correction Needed ──
  describe('buildCorrectionNeededEmail', () => {
    it('has standardised subject', () => {
      const { subject } = buildCorrectionNeededEmail({
        requestedBy: 'accountant@voanorthla.org',
        clientName: 'Bob Jones',
      });
      expect(subject).toBe('[SSVF-TFA] Correction Needed — Bob Jones');
    });

    it('falls back to "a submission" for missing client name', () => {
      const { subject } = buildCorrectionNeededEmail({
        requestedBy: 'acct@test.org',
      });
      expect(subject).toContain('a submission');
    });

    it('includes the correction message when provided', () => {
      const { html } = buildCorrectionNeededEmail({
        requestedBy: 'acct@test.org',
        clientName: 'Test',
        message: 'Wrong vendor selected',
      });
      expect(html).toContain('Wrong vendor selected');
    });

    it('handles newlines in correction message', () => {
      const { html } = buildCorrectionNeededEmail({
        requestedBy: 'acct@test.org',
        message: 'Line 1\nLine 2',
      });
      expect(html).toContain('Line 1<br>Line 2');
    });

    it('omits message block when no message provided', () => {
      const { html } = buildCorrectionNeededEmail({
        requestedBy: 'acct@test.org',
      });
      // The amber message div should not appear
      expect(html).not.toContain('#fef3c7');
    });

    it('includes requester name', () => {
      const { html } = buildCorrectionNeededEmail({
        requestedBy: 'accountant@voanorthla.org',
      });
      expect(html).toContain('accountant@voanorthla.org');
    });

    it('includes submission date when provided', () => {
      const { html } = buildCorrectionNeededEmail({
        requestedBy: 'acct@test.org',
        submissionDate: '2026-02-28T10:00:00Z',
      });
      expect(html).toContain('2026-02-28');
    });

    it('uses amber accent colour', () => {
      const { html } = buildCorrectionNeededEmail({
        requestedBy: 'acct@test.org',
      });
      expect(html).toContain('#f59e0b');
    });
  });

  // ── Correction Completed ──
  describe('buildCorrectionCompletedEmail', () => {
    it('has standardised subject', () => {
      const { subject } = buildCorrectionCompletedEmail({
        correctedBy: 'worker@test.org',
        clientName: 'Alice',
      });
      expect(subject).toBe('[SSVF-TFA] Correction Completed — Alice');
    });

    it('includes corrector name', () => {
      const { html } = buildCorrectionCompletedEmail({
        correctedBy: 'worker@voanorthla.org',
      });
      expect(html).toContain('worker@voanorthla.org');
    });

    it('mentions "In Review" status', () => {
      const { html } = buildCorrectionCompletedEmail({
        correctedBy: 'worker@test.org',
      });
      expect(html).toContain('In Review');
    });

    it('uses green accent colour', () => {
      const { html } = buildCorrectionCompletedEmail({
        correctedBy: 'x@test.org',
      });
      expect(html).toContain('#10b981');
    });
  });

  // ── New Message ──
  describe('buildMessageNotificationEmail', () => {
    it('has standardised subject', () => {
      const { subject } = buildMessageNotificationEmail({
        senderName: 'Russell Irby',
        messageText: 'Please check the vendor',
        clientName: 'Test Client',
      });
      expect(subject).toBe('[SSVF-TFA] New Message — Test Client');
    });

    it('falls back to "a submission" when clientName missing', () => {
      const { subject } = buildMessageNotificationEmail({
        senderName: 'User',
        messageText: 'hello',
      });
      expect(subject).toContain('a submission');
    });

    it('includes sender name and message text', () => {
      const { html } = buildMessageNotificationEmail({
        senderName: 'Russell Irby',
        messageText: 'Wrong amount — should be $350',
        clientName: 'Demo',
      });
      expect(html).toContain('Russell Irby');
      expect(html).toContain('Wrong amount — should be $350');
    });

    it('converts newlines in message to <br>', () => {
      const { html } = buildMessageNotificationEmail({
        senderName: 'User',
        messageText: 'First\nSecond',
      });
      expect(html).toContain('First<br>Second');
    });

    it('uses custom dashboard URL when provided', () => {
      const { html } = buildMessageNotificationEmail({
        senderName: 'U',
        messageText: 'test',
        dashboardUrl: 'https://custom.example.com',
      });
      expect(html).toContain('https://custom.example.com');
    });

    it('defaults to ssvf.northla.app when no dashboardUrl', () => {
      const { html } = buildMessageNotificationEmail({
        senderName: 'U',
        messageText: 'test',
      });
      expect(html).toContain('https://ssvf.northla.app');
    });
  });

  // ── Subject prefix consistency ──
  describe('all subjects use the [SSVF-TFA] prefix', () => {
    it.each([
      ['New Submission', buildNewSubmissionEmail({ submitterEmail: 'a@b.com', clientName: 'C' })],
      ['Correction Needed', buildCorrectionNeededEmail({ requestedBy: 'a@b.com', clientName: 'C' })],
      ['Correction Completed', buildCorrectionCompletedEmail({ correctedBy: 'a@b.com', clientName: 'C' })],
      ['New Message', buildMessageNotificationEmail({ senderName: 'X', messageText: 'y', clientName: 'C' })],
    ])('%s starts with [SSVF-TFA]', (_label, result) => {
      expect(result.subject).toMatch(/^\[SSVF-TFA\]/);
    });
  });
});


// ──────────────────────────────────────────────────
//  sendEmail / sendNotifyEmail tests
// ──────────────────────────────────────────────────
describe('graphClient – sendEmail', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Re-set env var (tests may delete it)
    process.env.NOTIFICATION_FROM_EMAIL = 'ssvf-notify@voanorthla.org';
    process.env.GRAPH_CLIENT_SECRET = 'test-secret';
  });

  it('calls Graph API with correct endpoint and payload', async () => {
    await sendEmail('recipient@test.org', 'Test Subject', '<p>body</p>');

    expect(mockApi).toHaveBeenCalledWith('/users/ssvf-notify@voanorthla.org/sendMail');
    expect(mockPost).toHaveBeenCalledWith({
      message: expect.objectContaining({
        subject: 'Test Subject',
        body: { contentType: 'HTML', content: '<p>body</p>' },
        toRecipients: [{ emailAddress: { address: 'recipient@test.org' } }],
      }),
    });
  });

  it('skips sending when NOTIFICATION_FROM_EMAIL is not set', async () => {
    delete process.env.NOTIFICATION_FROM_EMAIL;
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

    await sendEmail('a@b.com', 'subj', '<p>x</p>');

    expect(mockApi).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('NOTIFICATION_FROM_EMAIL not configured')
    );
    warnSpy.mockRestore();
  });

  it('does not throw when Graph API call fails', async () => {
    mockPost.mockRejectedValueOnce(new Error('Graph 403'));
    const errSpy = jest.spyOn(console, 'error').mockImplementation();

    // Should resolve (not reject)
    await expect(sendEmail('a@b.com', 'subj', '<p>x</p>')).resolves.toBeUndefined();

    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to send email'),
      'Graph 403'
    );
    errSpy.mockRestore();
  });
});

describe('graphClient – sendNotifyEmail', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NOTIFICATION_FROM_EMAIL = 'ssvf-notify@voanorthla.org';
    process.env.GRAPH_CLIENT_SECRET = 'test-secret';
  });

  it('sends to the NOTIFICATION_FROM_EMAIL mailbox (self)', async () => {
    await sendNotifyEmail('Subject', '<p>html</p>');

    expect(mockApi).toHaveBeenCalledWith('/users/ssvf-notify@voanorthla.org/sendMail');
    expect(mockPost).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.objectContaining({
          toRecipients: [{ emailAddress: { address: 'ssvf-notify@voanorthla.org' } }],
        }),
      })
    );
  });

  it('skips when NOTIFICATION_FROM_EMAIL is not set', async () => {
    delete process.env.NOTIFICATION_FROM_EMAIL;
    await sendNotifyEmail('Subj', '<p>x</p>');
    expect(mockApi).not.toHaveBeenCalled();
  });
});
