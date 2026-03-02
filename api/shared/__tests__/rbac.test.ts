import { resolveRole, isElevated, canAccessSubmission, AuthenticatedUser } from '../rbac';

describe('resolveRole', () => {
  const ACCOUNTING_GROUP_ID = '5b130c87-5b6c-4d20-b053-5c5f2ebe0cf0';

  it('returns admin for russell.irby@voanorthla.org', () => {
    expect(resolveRole('russell.irby@voanorthla.org', [])).toBe('admin');
  });

  it('returns admin for admin email regardless of case', () => {
    expect(resolveRole('Russell.Irby@VOANORTHLA.org', [])).toBe('admin');
  });

  it('returns admin even if also in accounting group', () => {
    expect(resolveRole('russell.irby@voanorthla.org', [ACCOUNTING_GROUP_ID])).toBe('admin');
  });

  it('returns accounting for user in accounting group', () => {
    expect(resolveRole('erin.brinley@voanorthla.org', [ACCOUNTING_GROUP_ID])).toBe('accounting');
  });

  it('returns accounting when user has multiple groups including accounting', () => {
    expect(resolveRole('nora.greer@voanorthla.org', ['some-other-group', ACCOUNTING_GROUP_ID, 'another-group'])).toBe('accounting');
  });

  it('returns user for regular authenticated user', () => {
    expect(resolveRole('caseworker@voanorthla.org', ['some-other-group'])).toBe('user');
  });

  it('returns user when no groups provided', () => {
    expect(resolveRole('caseworker@voanorthla.org', undefined)).toBe('user');
  });

  it('returns user when email is undefined and no accounting group', () => {
    expect(resolveRole(undefined, [])).toBe('user');
  });
});

describe('isElevated', () => {
  it('returns true for admin', () => {
    expect(isElevated('admin')).toBe(true);
  });

  it('returns true for accounting', () => {
    expect(isElevated('accounting')).toBe(true);
  });

  it('returns false for user', () => {
    expect(isElevated('user')).toBe(false);
  });
});

describe('canAccessSubmission', () => {
  const adminUser: AuthenticatedUser = {
    userId: 'admin-oid',
    email: 'russell.irby@voanorthla.org',
    userName: 'Russell Irby',
    role: 'admin',
  };

  const accountingUser: AuthenticatedUser = {
    userId: 'acct-oid',
    email: 'erin.brinley@voanorthla.org',
    userName: 'Erin Brinley',
    role: 'accounting',
  };

  const regularUser: AuthenticatedUser = {
    userId: 'user-oid',
    email: 'caseworker@voanorthla.org',
    userName: 'Case Worker',
    role: 'user',
  };

  it('admin can access any submission', () => {
    expect(canAccessSubmission(adminUser, 'someone.else@voanorthla.org')).toBe(true);
  });

  it('accounting can access any submission', () => {
    expect(canAccessSubmission(accountingUser, 'someone.else@voanorthla.org')).toBe(true);
  });

  it('regular user can access own submission', () => {
    expect(canAccessSubmission(regularUser, 'caseworker@voanorthla.org')).toBe(true);
  });

  it('regular user cannot access others submission', () => {
    expect(canAccessSubmission(regularUser, 'other.person@voanorthla.org')).toBe(false);
  });

  it('email comparison is case-insensitive', () => {
    expect(canAccessSubmission(regularUser, 'Caseworker@VOANORTHLA.org')).toBe(true);
  });

  it('returns false when user email is missing', () => {
    const noEmail: AuthenticatedUser = { userId: 'x', role: 'user' };
    expect(canAccessSubmission(noEmail, 'someone@example.com')).toBe(false);
  });
});
