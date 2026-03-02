import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { queryCaptures, QueryOptions } from '../shared/cosmosClient';
import { validateAuthWithRole, isElevated } from '../shared/rbac';

/**
 * Export captures for accounting/reporting
 * Supports filtering by date range, service type, etc.
 * Returns JSON (can be easily converted to CSV by caller)
 * Accepts both Entra ID JWT tokens and legacy session tokens.
 */
export async function ExportCaptures(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  // CORS headers
  const origin = request.headers.get('origin') || '';
  const allowedOrigins = [
    'https://wscs.wellsky.com',
    'https://ssvf.northla.app',
    'https://wonderful-sand-00129870f.1.azurestaticapps.net',
    'http://localhost:5173',
    'http://localhost:4280',
  ];
  
  const corsHeaders = {
    'Access-Control-Allow-Origin': allowedOrigins.includes(origin) ? origin : allowedOrigins[0],
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
  };

  if (request.method === 'OPTIONS') {
    return { status: 204, headers: corsHeaders };
  }

  // Auth + RBAC — elevated only (admin / accounting)
  const auth = await validateAuthWithRole(request, context);
  if (!auth.valid) {
    return { status: 401, jsonBody: { error: 'Unauthorized' }, headers: corsHeaders };
  }
  if (!isElevated(auth.role)) {
    return { status: 403, jsonBody: { error: 'Export is restricted to accounting and admin users' }, headers: corsHeaders };
  }

  try {
    // Parse query parameters
    const url = new URL(request.url);
    const queryOptions: QueryOptions = {
      serviceType: url.searchParams.get('serviceType') || undefined,
      startDate: url.searchParams.get('startDate') || undefined,
      endDate: url.searchParams.get('endDate') || undefined,
      userId: url.searchParams.get('userId') || undefined,
    };

    const captures = await queryCaptures(queryOptions);

    // Check if CSV format requested
    const format = url.searchParams.get('format');
    if (format === 'csv') {
      const csv = convertToCSV(captures);
      return {
        status: 200,
        body: csv,
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="captures_${new Date().toISOString().split('T')[0]}.csv"`,
        },
      };
    }

    return {
      status: 200,
      jsonBody: {
        count: captures.length,
        captures,
      },
      headers: corsHeaders,
    };
  } catch (error) {
    context.error('Export error:', error);
    return {
      status: 500,
      jsonBody: { error: 'Server error' },
      headers: corsHeaders,
    };
  }
}

function convertToCSV(captures: any[]): string {
  if (captures.length === 0) {
    return 'No data';
  }

  // Define columns for accounting export
  const columns = [
    'id',
    'captured_at_utc',
    'service_type',
    'vendor',
    'vendor_account',
    'service_amount',
    'client_name',
    'user_id',
    'source_url',
  ];

  const header = columns.join(',');
  const rows = captures.map(c => {
    return columns.map(col => {
      const value = c[col];
      if (value === null || value === undefined) return '';
      // Escape quotes and wrap in quotes if contains comma
      const str = String(value);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    }).join(',');
  });

  return [header, ...rows].join('\n');
}

app.http('ExportCaptures', {
  methods: ['GET', 'OPTIONS'],
  route: 'captures/export',
  authLevel: 'anonymous',
  handler: ExportCaptures,
});
