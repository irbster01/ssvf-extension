/**
 * Centralized CORS configuration.
 * All endpoints import from here — single place to update origins.
 */

/** Production-safe origins (no localhost). */
const PRODUCTION_ORIGINS = [
  'https://ssvf-capture-api.azurewebsites.net',
  'https://wscs.wellsky.com',
  'https://wonderful-sand-00129870f.1.azurestaticapps.net',
  'https://ssvf.northla.app',
];

/** Local dev origins — only added when AZURE_FUNCTIONS_ENVIRONMENT !== 'Production'. */
const DEV_ORIGINS = [
  'http://localhost:4280',
  'http://localhost:5173',
];

const isProduction = process.env.AZURE_FUNCTIONS_ENVIRONMENT === 'Production'
  || process.env.NODE_ENV === 'production';

/** Full allowed origins list (dev origins excluded in production). */
export const ALLOWED_ORIGINS: readonly string[] = isProduction
  ? PRODUCTION_ORIGINS
  : [...PRODUCTION_ORIGINS, ...DEV_ORIGINS];

const CHROME_EXT_PREFIX = 'chrome-extension://';

export function isAllowedOrigin(origin: string): boolean {
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  if (origin.startsWith(CHROME_EXT_PREFIX)) return true;
  return false;
}

/**
 * Build CORS response headers for a given request origin and allowed methods.
 * Pass the methods your endpoint actually handles (e.g. 'GET, POST, OPTIONS').
 */
export function getCorsHeaders(origin: string, methods: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': isAllowedOrigin(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': methods,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
  };
}
