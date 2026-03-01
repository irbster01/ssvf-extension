/**
 * Tests for the rate limiter module.
 * Only tests the in-memory path since Redis requires a live connection.
 */

// Ensure no Redis is configured so we test the in-memory fallback
delete process.env.REDIS_CONNECTION_STRING;

// Mock the dynamic redis import to avoid module-not-found error
jest.mock('redis', () => {
  throw new Error('redis not installed');
}, { virtual: true });

import { checkRateLimitDistributed } from '../rateLimiter';

describe('rateLimiter (in-memory fallback)', () => {
  it('allows requests under the limit', async () => {
    const userId = `test-user-${Date.now()}-allow`;
    const result = await checkRateLimitDistributed(userId, 60000, 10);
    expect(result.allowed).toBe(true);
    expect(result.remainingRequests).toBe(9);
  });

  it('counts requests correctly', async () => {
    const userId = `test-user-${Date.now()}-count`;
    const limit = 5;

    for (let i = 0; i < limit; i++) {
      const result = await checkRateLimitDistributed(userId, 60000, limit);
      expect(result.allowed).toBe(true);
      expect(result.remainingRequests).toBe(limit - 1 - i);
    }

    // Next request should be blocked
    const blocked = await checkRateLimitDistributed(userId, 60000, limit);
    expect(blocked.allowed).toBe(false);
  });

  it('resets after window expires', async () => {
    const userId = `test-user-${Date.now()}-reset`;
    const windowMs = 100; // 100ms window for fast test
    const limit = 2;

    // Use up the limit
    await checkRateLimitDistributed(userId, windowMs, limit);
    await checkRateLimitDistributed(userId, windowMs, limit);
    const blocked = await checkRateLimitDistributed(userId, windowMs, limit);
    expect(blocked.allowed).toBe(false);

    // Wait for the window to expire
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Should be allowed again
    const afterReset = await checkRateLimitDistributed(userId, windowMs, limit);
    expect(afterReset.allowed).toBe(true);
  });

  it('tracks different users independently', async () => {
    const userA = `test-user-${Date.now()}-A`;
    const userB = `test-user-${Date.now()}-B`;
    const limit = 2;

    // Use up limit for user A
    await checkRateLimitDistributed(userA, 60000, limit);
    await checkRateLimitDistributed(userA, 60000, limit);
    const blockedA = await checkRateLimitDistributed(userA, 60000, limit);
    expect(blockedA.allowed).toBe(false);

    // User B should still have full quota
    const resultB = await checkRateLimitDistributed(userB, 60000, limit);
    expect(resultB.allowed).toBe(true);
    expect(resultB.remainingRequests).toBe(1);
  });
});
