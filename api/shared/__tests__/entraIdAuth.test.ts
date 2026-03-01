/**
 * Tests for entraIdAuth utilities.
 * Tests isJwtToken and validateEntraIdToken claim-validation logic.
 */
import jwt from 'jsonwebtoken';
import { validateEntraIdToken, isJwtToken } from '../entraIdAuth';

// The module reads AZURE_TENANT_ID at load time; if not set it defaults to this value
const TENANT_ID = process.env.AZURE_TENANT_ID || '38c1626e-b75d-40a6-b21b-0aae1191c730';

describe('entraIdAuth', () => {
  describe('isJwtToken', () => {
    it('returns true for a JWT-shaped string (3 dot-separated parts)', () => {
      expect(isJwtToken('header.payload.signature')).toBe(true);
    });

    it('returns false for a simple bearer token', () => {
      expect(isJwtToken('abc123def456')).toBe(false);
    });

    it('returns false for a token with 2 parts', () => {
      expect(isJwtToken('part1.part2')).toBe(false);
    });

    it('returns false for an empty string', () => {
      expect(isJwtToken('')).toBe(false);
    });

    it('returns true for dummy JWT with real base64 parts', () => {
      // Create a real JWT to test with
      const token = jwt.sign(
        { sub: 'user-1', tid: 'test-tenant-id' },
        'secret',
        { expiresIn: '1h' }
      );
      expect(isJwtToken(token)).toBe(true);
    });
  });

  describe('validateEntraIdToken', () => {
    it('validates a token with correct tenant and non-expired', async () => {
      const token = jwt.sign(
        {
          sub: 'user-123',
          oid: 'oid-456',
          name: 'Test User',
          preferred_username: 'test@org.com',
          tid: TENANT_ID,
          exp: Math.floor(Date.now() / 1000) + 3600,
        },
        'secret' // We don't verify signature, just decode
      );

      const result = await validateEntraIdToken(token);

      expect(result.valid).toBe(true);
      expect(result.userId).toBe('oid-456');
      expect(result.userName).toBe('Test User');
      expect(result.email).toBe('test@org.com');
    });

    it('rejects an expired token', async () => {
      const token = jwt.sign(
        {
          sub: 'user-123',
          tid: TENANT_ID,
          exp: Math.floor(Date.now() / 1000) - 3600, // expired 1 hour ago
        },
        'secret'
      );

      const result = await validateEntraIdToken(token);
      expect(result.valid).toBe(false);
    });

    it('rejects a token from the wrong tenant', async () => {
      const token = jwt.sign(
        {
          sub: 'user-123',
          tid: 'wrong-tenant-id',
          exp: Math.floor(Date.now() / 1000) + 3600,
        },
        'secret'
      );

      const result = await validateEntraIdToken(token);
      expect(result.valid).toBe(false);
    });

    it('rejects a token with no user ID', async () => {
      const token = jwt.sign(
        {
          tid: TENANT_ID,
          exp: Math.floor(Date.now() / 1000) + 3600,
          // No sub or oid
        },
        'secret'
      );

      const result = await validateEntraIdToken(token);
      expect(result.valid).toBe(false);
    });

    it('rejects a completely invalid token string', async () => {
      const result = await validateEntraIdToken('not-a-jwt');
      expect(result.valid).toBe(false);
    });

    it('falls back to upn when preferred_username is missing', async () => {
      const token = jwt.sign(
        {
          sub: 'user-123',
          tid: TENANT_ID,
          upn: 'user@upn.com',
          exp: Math.floor(Date.now() / 1000) + 3600,
        },
        'secret'
      );

      const result = await validateEntraIdToken(token);
      expect(result.valid).toBe(true);
      expect(result.email).toBe('user@upn.com');
    });

    it('uses sub when oid is missing', async () => {
      const token = jwt.sign(
        {
          sub: 'sub-user-789',
          tid: TENANT_ID,
          name: 'Sub User',
          email: 'sub@test.com',
          exp: Math.floor(Date.now() / 1000) + 3600,
        },
        'secret'
      );

      const result = await validateEntraIdToken(token);
      expect(result.valid).toBe(true);
      expect(result.userId).toBe('sub-user-789');
    });
  });
});
