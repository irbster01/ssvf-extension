import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { getClientsContainer } from '../shared/cosmosClient';
import { validateAuthWithRole, AuthResult } from '../shared/rbac';

export interface ClientRecord {
  id: string;          // Wellsky Client ID (also partition key)
  clientName: string;  // "FirstName LastName"
  provider?: string;   // Last entry provider from seed
  program?: string;    // Derived: 'Homeless Prevention' | 'Rapid Rehousing'
  region?: string;     // Derived: 'Arkansas' (or saved by user)
  addedBy?: string;
  addedAt?: string;
}

/**
 * GET /api/clients — Return all client records for autocomplete.
 * The dataset is small (~2500) so we return everything and filter client-side.
 */
async function getClients(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const auth = await validateAuthWithRole(request, context);
  if (!auth.valid) {
    return { status: 401, jsonBody: { error: 'Unauthorized' } };
  }

  try {
    const container = await getClientsContainer();
    const { resources } = await container.items
      .query<ClientRecord>('SELECT c.id, c.clientName, c.provider, c.program, c.region FROM c ORDER BY c.clientName')
      .fetchAll();

    return {
      status: 200,
      jsonBody: { clients: resources },
    };
  } catch (err: any) {
    context.error('Failed to fetch clients:', err);
    return { status: 500, jsonBody: { error: 'Failed to fetch clients' } };
  }
}

/**
 * POST /api/clients — Add a new client (appends to seed).
 * Body: { id: string, clientName: string }
 * If the client ID already exists, updates the name.
 */
async function addClient(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const auth = await validateAuthWithRole(request, context);
  if (!auth.valid) {
    return { status: 401, jsonBody: { error: 'Unauthorized' } };
  }

  try {
    const body = await request.json() as any;
    const clientId = (body.id || '').toString().trim();
    const clientName = (body.clientName || '').toString().trim();

    if (!clientId || !clientName) {
      return { status: 400, jsonBody: { error: 'id and clientName are required' } };
    }

    const container = await getClientsContainer();

    const program = (body.program || '').toString().trim() || undefined;
    const region = (body.region || '').toString().trim() || undefined;

    // Read existing record first so we don't clobber seed data
    let existing: ClientRecord | undefined;
    try {
      const { resource } = await container.item(clientId, clientId).read<ClientRecord>();
      existing = resource ?? undefined;
    } catch { /* not found */ }

    const record: ClientRecord = {
      ...existing,
      id: clientId,
      clientName,
      program: program || existing?.program,
      region: region || existing?.region,
      addedBy: existing?.addedBy || auth.email || 'unknown',
      addedAt: existing?.addedAt || new Date().toISOString(),
    };

    // Upsert — if ID exists, update; otherwise create
    await container.items.upsert(record);

    context.log(`Client upserted: ${clientId} "${clientName}" by ${auth.email}`);

    return {
      status: 200,
      jsonBody: record,
    };
  } catch (err: any) {
    context.error('Failed to add client:', err);
    return { status: 500, jsonBody: { error: 'Failed to add client' } };
  }
}

app.http('GetClients', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'clients',
  handler: getClients,
});

app.http('AddClient', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'clients',
  handler: addClient,
});
