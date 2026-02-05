import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';

const API_KEY = process.env.API_KEY || '';
const LAKEHOUSE_URL = 'https://nzrmcoc5w6tebmq3bkxbdeohga-y7eucqqylblezera7l3de5axoa.datawarehouse.fabric.microsoft.com';

export async function GetSubmissions(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  context.log('=== GetSubmissions: Fetching recent submissions ===');

  // CORS headers
  const origin = request.headers.get('origin') || '*';
  const corsHeaders = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-api-key',
    'Access-Control-Allow-Credentials': 'false',
  };

  // Handle preflight OPTIONS request
  if (request.method === 'OPTIONS') {
    context.log('Handling OPTIONS preflight request');
    return {
      status: 204,
      headers: corsHeaders,
    };
  }

  // Validate API key
  const apiKey = request.headers.get('x-api-key');
  const expectedKey = process.env.API_KEY || '';
  
  if (apiKey !== expectedKey) {
    context.warn(`❌ Invalid API key`);
    return {
      status: 401,
      jsonBody: { error: 'Unauthorized' },
      headers: corsHeaders,
    };
  }
  context.log(`✅ API key validated successfully`);

  try {
    // For now, return mock data since Fabric SQL endpoint needs proper setup
    // TODO: Configure Fabric SQL Analytics endpoint properly
    
    const limit = parseInt(request.query.get('limit') || '20');
    
    context.log('Returning submissions from storage (Fabric endpoint needs configuration)');

    // Mock data structure - in production this would come from Fabric
    // For now, the sidebar will fall back to Chrome local storage
    // which already has the real data from captures
    
    return {
      status: 200,
      jsonBody: {
        success: true,
        submissions: [],
        count: 0,
        message: 'Using local storage fallback - Fabric SQL endpoint configuration pending',
      },
      headers: corsHeaders,
    };

  } catch (error: any) {
    context.error('Error fetching submissions:', error);
    
    return {
      status: 500,
      jsonBody: {
        error: 'Internal server error',
        message: error.message,
      },
      headers: corsHeaders,
    };
  }
}

app.http('GetSubmissions', {
  methods: ['GET', 'OPTIONS'],
  route: 'submissions',
  authLevel: 'anonymous',
  handler: GetSubmissions,
});
