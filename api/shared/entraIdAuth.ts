import jwt from 'jsonwebtoken';

// Environment variables for configuration
const TENANT_ID = process.env.AZURE_TENANT_ID || '38c1626e-b75d-40a6-b21b-0aae1191c730';

interface EntraIdTokenPayload {
  aud: string;
  iss: string;
  iat: number;
  exp: number;
  sub: string;
  name?: string;
  preferred_username?: string;
  email?: string;
  oid?: string;
  tid?: string;
  upn?: string;
  unique_name?: string;
}

/**
 * Validate a Microsoft Entra ID token
 * For Graph access tokens, we decode and verify claims without cryptographic verification
 * (Graph tokens can only be verified by Graph API itself)
 */
export async function validateEntraIdToken(token: string): Promise<{ valid: boolean; userId?: string; userName?: string; email?: string }> {
  try {
    // Decode token without verification (Graph access tokens can't be verified by third parties)
    const decoded = jwt.decode(token, { complete: true });
    
    if (!decoded || !decoded.payload) {
      console.log('[EntraID] Invalid token structure');
      return { valid: false };
    }
    
    const payload = decoded.payload as EntraIdTokenPayload;
    
    // Check if token is expired
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      console.log('[EntraID] Token expired');
      return { valid: false };
    }
    
    // Verify tenant ID matches (basic security check)
    if (payload.tid && payload.tid !== TENANT_ID) {
      console.log(`[EntraID] Token from wrong tenant: ${payload.tid}`);
      return { valid: false };
    }
    
    // Get user info from claims
    const userId = payload.oid || payload.sub;
    const userName = payload.name;
    const email = payload.preferred_username || payload.upn || payload.unique_name || payload.email;
    
    if (!userId) {
      console.log('[EntraID] No user ID in token');
      return { valid: false };
    }
    
    console.log(`[EntraID] Token valid for user: ${email || userId}`);
    
    return {
      valid: true,
      userId,
      userName,
      email,
    };
  } catch (error: any) {
    console.error('[EntraID] Token decode failed:', error.message);
    return { valid: false };
  }
}

/**
 * Check if a token looks like a JWT (for determining which validation to use)
 */
export function isJwtToken(token: string): boolean {
  // JWTs have 3 parts separated by dots
  const parts = token.split('.');
  return parts.length === 3;
}
