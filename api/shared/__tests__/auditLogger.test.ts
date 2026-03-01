import { logAuditEvent, getClientIp, createBaseAuditEvent, AuditEvent } from '../auditLogger';

describe('auditLogger', () => {
  describe('getClientIp', () => {
    it('returns x-forwarded-for first entry', () => {
      const headers = new Headers({
        'x-forwarded-for': '1.2.3.4, 5.6.7.8',
        'x-client-ip': '10.0.0.1',
      });
      expect(getClientIp(headers)).toBe('1.2.3.4');
    });

    it('falls back to x-client-ip', () => {
      const headers = new Headers({ 'x-client-ip': '10.0.0.1' });
      expect(getClientIp(headers)).toBe('10.0.0.1');
    });

    it('falls back to x-real-ip', () => {
      const headers = new Headers({ 'x-real-ip': '192.168.1.1' });
      expect(getClientIp(headers)).toBe('192.168.1.1');
    });

    it('returns "unknown" when no headers present', () => {
      const headers = new Headers();
      expect(getClientIp(headers)).toBe('unknown');
    });
  });

  describe('createBaseAuditEvent', () => {
    it('creates a base event with correct fields', () => {
      const headers = new Headers({
        'x-forwarded-for': '203.0.113.50',
        'origin': 'https://ssvf.northla.app',
      });
      const request = {
        headers,
        method: 'POST',
        url: 'https://api.example.com/api/captures',
      };

      const result = createBaseAuditEvent(request, '/api/captures');

      expect(result.ipAddress).toBe('203.0.113.50');
      expect(result.origin).toBe('https://ssvf.northla.app');
      expect(result.endpoint).toBe('/api/captures');
      expect(result.method).toBe('POST');
      expect(result.timestamp).toBeDefined();
      expect(new Date(result.timestamp).getTime()).not.toBeNaN();
    });

    it('handles missing origin header', () => {
      const headers = new Headers();
      const request = { headers, method: 'GET', url: 'https://api.example.com/api/test' };

      const result = createBaseAuditEvent(request, '/api/test');
      expect(result.origin).toBeUndefined();
      expect(result.ipAddress).toBe('unknown');
    });
  });

  describe('logAuditEvent', () => {
    it('logs successful events via context.log', () => {
      const mockContext = {
        log: jest.fn(),
        warn: jest.fn(),
      } as any;

      const event: AuditEvent = {
        event: 'AUTH_SUCCESS',
        userId: 'user-123',
        email: 'user@test.com',
        ipAddress: '1.2.3.4',
        endpoint: '/api/captures',
        method: 'POST',
        timestamp: new Date().toISOString(),
        success: true,
      };

      logAuditEvent(mockContext, event);

      expect(mockContext.log).toHaveBeenCalledTimes(1);
      expect(mockContext.warn).not.toHaveBeenCalled();

      const loggedStr = mockContext.log.mock.calls[0][1];
      const parsed = JSON.parse(loggedStr);
      expect(parsed.auditLog).toBe(true);
      expect(parsed.event).toBe('AUTH_SUCCESS');
      expect(parsed.userId).toBe('user-123');
    });

    it('logs failed events via context.warn', () => {
      const mockContext = {
        log: jest.fn(),
        warn: jest.fn(),
      } as any;

      const event: AuditEvent = {
        event: 'AUTH_FAILURE',
        ipAddress: '1.2.3.4',
        endpoint: '/api/captures',
        method: 'POST',
        timestamp: new Date().toISOString(),
        success: false,
        details: { reason: 'invalid token' },
      };

      logAuditEvent(mockContext, event);

      expect(mockContext.warn).toHaveBeenCalledTimes(1);
      expect(mockContext.log).not.toHaveBeenCalled();

      const loggedStr = mockContext.warn.mock.calls[0][1];
      const parsed = JSON.parse(loggedStr);
      expect(parsed.auditLog).toBe(true);
      expect(parsed.event).toBe('AUTH_FAILURE');
      expect(parsed.success).toBe(false);
      expect(parsed.details.reason).toBe('invalid token');
    });
  });
});
