/**
 * RBAC (Role-Based Access Control) for the SSVF TFA system.
 *
 * Three tiers:
 *  1. Admin   — russell.irby@voanorthla.org — full access
 *  2. Accounting — members of "SharePoint - Accounting" Entra group — reviewer access
 *  3. User    — any authenticated org user — own submissions only
 *
 * Roles are derived from:
 *  - The `groups` claim in the Entra ID JWT (requires groupMembershipClaims=SecurityGroup on the app reg)
 *  - A hard-coded admin email override
 */

import { HttpRequest, InvocationContext } from '@azure/functions';
import { validateEntraIdToken, isJwtToken } from './entraIdAuth';

// Entra Object ID for "SharePoint - Accounting" group
const ACCOUNTING_GROUP_ID = process.env.ACCOUNTING_GROUP_ID || '5b130c87-5b6c-4d20-b053-5c5f2ebe0cf0';

// Hard-coded admin overrides
const ADMIN_EMAILS: string[] = [
  'russell.irby@voanorthla.org',
  'nora.greer@voanorthla.org',
];

export type UserRole = 'admin' | 'accounting' | 'user';

export interface AuthenticatedUser {
  userId: string;
  email?: string;
  userName?: string;
  role: UserRole;
  groups?: string[];
}

/**
 * Determine a user's role from their JWT claims.
 */
export function resolveRole(email: string | undefined, groups: string[] | undefined): UserRole {
  // 1. Admin override by email
  if (email && ADMIN_EMAILS.includes(email.toLowerCase())) {
    return 'admin';
  }

  // 2. Accounting group membership
  if (groups && groups.includes(ACCOUNTING_GROUP_ID)) {
    return 'accounting';
  }

  // 3. Default: regular user
  return 'user';
}

/**
 * Check if a user has "elevated" access (admin or accounting).
 * Elevated users can see all submissions, change statuses, create POs, etc.
 */
export function isElevated(role: UserRole): boolean {
  return role === 'admin' || role === 'accounting';
}

/**
 * Check if a user can access a specific submission.
 * Elevated users can access any. Regular users can only access their own.
 *  - `submissionUserId` is the `user_id` field on the submission (email of original submitter).
 */
export function canAccessSubmission(
  user: AuthenticatedUser,
  submissionUserId: string
): boolean {
  if (isElevated(user.role)) return true;

  // Compare by email (case-insensitive)
  const userEmail = (user.email || '').toLowerCase();
  const subEmail = (submissionUserId || '').toLowerCase();
  return userEmail === subEmail;
}

// ──────────────────────────────────────────────────
//  Centralised auth + role resolution for API endpoints
// ──────────────────────────────────────────────────

export type AuthResult =
  | { valid: false }
  | ({ valid: true } & AuthenticatedUser);

/**
 * Validate the request's Bearer token and resolve the user's RBAC role.
 * Drop-in replacement for all the per-file `validateAuth()` helpers.
 */
export async function validateAuthWithRole(
  request: HttpRequest,
  context: InvocationContext,
): Promise<AuthResult> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    context.warn('[RBAC] Missing or invalid authorization header');
    return { valid: false };
  }

  const token = authHeader.substring(7);

  if (!isJwtToken(token)) {
    context.warn('[RBAC] Non-JWT token rejected');
    return { valid: false };
  }

  const validation = await validateEntraIdToken(token);
  if (!validation.valid || !validation.userId) {
    context.warn('[RBAC] Invalid or expired Entra ID token');
    return { valid: false };
  }

  const email = validation.email;
  const role = resolveRole(email, validation.groups);

  context.log(`[RBAC] ${email || validation.userId} → role=${role}`);

  return {
    valid: true,
    userId: validation.userId,
    email,
    userName: validation.userName,
    role,
    groups: validation.groups,
  };
}
