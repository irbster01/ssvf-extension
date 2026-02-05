import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { queryCaptures, ServiceCapture } from '../shared/cosmosClient';

export async function ViewLogs(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log('ViewLogs function processed a request.');

  // CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  // Handle preflight OPTIONS request
  if (request.method === 'OPTIONS') {
    return {
      status: 204,
      headers: corsHeaders,
    };
  }

  try {
    // Get optional date parameter for filtering
    const dateParam = request.query.get('date');
    const serviceType = request.query.get('serviceType') || undefined;
    
    let startDate: string | undefined;
    let endDate: string | undefined;
    
    if (dateParam) {
      const date = new Date(dateParam);
      startDate = date.toISOString().split('T')[0] + 'T00:00:00.000Z';
      endDate = date.toISOString().split('T')[0] + 'T23:59:59.999Z';
    }

    const logs = await queryCaptures({ serviceType, startDate, endDate });

    context.log(`Found ${logs.length} log entries`);

    const today = new Date().toISOString().split('T')[0];

    // Return as HTML for easy viewing
    const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Service Captures - ${dateParam || today}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
    h1 { color: #333; }
    .log-entry { 
      background: white; 
      margin: 10px 0; 
      padding: 15px; 
      border-radius: 5px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .log-header { 
      font-weight: bold; 
      color: #0066cc; 
      margin-bottom: 10px;
      display: flex;
      justify-content: space-between;
    }
    .log-time { color: #666; font-size: 0.9em; }
    .log-url { color: #009900; margin: 5px 0; word-break: break-all; }
    .field-grid { 
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 10px;
      margin: 10px 0;
    }
    .field { 
      background: #f9f9f9; 
      padding: 8px;
      border-radius: 4px;
    }
    .field-name { font-weight: bold; color: #666; font-size: 0.85em; }
    .field-value { color: #333; }
    .metadata { color: #666; font-size: 0.9em; margin-top: 10px; }
    .count { background: #0066cc; color: white; padding: 5px 15px; border-radius: 3px; }
    .service-type { 
      background: #4CAF50; 
      color: white; 
      padding: 2px 8px; 
      border-radius: 3px; 
      font-size: 0.85em;
    }
    .amount { font-size: 1.2em; color: #2196F3; font-weight: bold; }
  </style>
</head>
<body>
  <h1>Service Captures <span class="count">${logs.length} entries</span></h1>
  <p><strong>Date:</strong> ${dateParam || 'All'} | <strong>Service Type:</strong> ${serviceType || 'All'}</p>
  <hr/>
  ${logs.map((log: ServiceCapture, index: number) => `
    <div class="log-entry">
      <div class="log-header">
        <span>
          #${index + 1} 
          <span class="service-type">${log.service_type || 'Unknown'}</span>
          ${log.service_amount ? `<span class="amount">$${log.service_amount.toFixed(2)}</span>` : ''}
        </span>
        <span class="log-time">${log.captured_at_utc || 'N/A'}</span>
      </div>
      <div class="field-grid">
        ${log.vendor ? `<div class="field"><div class="field-name">Vendor</div><div class="field-value">${log.vendor}</div></div>` : ''}
        ${log.vendor_account ? `<div class="field"><div class="field-name">Account #</div><div class="field-value">${log.vendor_account}</div></div>` : ''}
        ${log.client_name ? `<div class="field"><div class="field-name">Client Name</div><div class="field-value">${log.client_name}</div></div>` : ''}
        <div class="field"><div class="field-name">User</div><div class="field-value">${log.user_id}</div></div>
      </div>
      <div class="log-url"><strong>Source:</strong> ${log.source_url}</div>
      <details>
        <summary>All captured fields (${Object.keys(log.form_data || {}).length})</summary>
        <pre style="background: #f5f5f5; padding: 10px; overflow-x: auto; font-size: 0.85em;">${JSON.stringify(log.form_data, null, 2)}</pre>
      </details>
      <div class="metadata"><strong>ID:</strong> ${log.id} | <strong>Received:</strong> ${log.received_at_utc}</div>
    </div>
  `).join('')}
</body>
</html>
    `;

    return {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/html',
      },
      body: html,
    };
  } catch (error) {
    context.error('Error reading logs:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/html',
      },
      body: `
<!DOCTYPE html>
<html>
<head>
  <title>Error</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; }
    .error { background: #ffebee; color: #c62828; padding: 20px; border-radius: 5px; }
  </style>
</head>
<body>
  <h1>Error Reading Logs</h1>
  <div class="error">
    <p><strong>Error:</strong> ${errorMessage}</p>
  </div>
</body>
</html>
      `,
    };
  }
}

app.http('ViewLogs', {
  methods: ['GET', 'OPTIONS'],
  route: 'logs',
  authLevel: 'anonymous',
  handler: ViewLogs,
});
