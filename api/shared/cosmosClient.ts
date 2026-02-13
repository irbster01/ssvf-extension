import { CosmosClient, Container, Database } from '@azure/cosmos';

// Singleton pattern for connection reuse
let client: CosmosClient | null = null;
let container: Container | null = null;

export interface CosmosConfig {
  endpoint: string;
  key: string;
  databaseId: string;
  containerId: string;
}

function getConfig(): CosmosConfig {
  const endpoint = process.env.COSMOS_ENDPOINT;
  const key = process.env.COSMOS_KEY;
  const databaseId = process.env.COSMOS_DATABASE || 'ssvf-services';
  const containerId = process.env.COSMOS_CONTAINER || 'captures';

  if (!endpoint || !key) {
    throw new Error('COSMOS_ENDPOINT and COSMOS_KEY environment variables are required');
  }

  return { endpoint, key, databaseId, containerId };
}

/**
 * Get or create the Cosmos DB container (singleton)
 */
export async function getContainer(): Promise<Container> {
  if (container) {
    return container;
  }

  const config = getConfig();
  
  client = new CosmosClient({
    endpoint: config.endpoint,
    key: config.key,
  });

  // Create database if it doesn't exist
  const { database } = await client.databases.createIfNotExists({
    id: config.databaseId,
  });

  // Create container if it doesn't exist
  // Partition key: /service_type for efficient queries by service type
  // Also good for accounting exports filtered by service
  const { container: cont } = await database.containers.createIfNotExists({
    id: config.containerId,
    partitionKey: { paths: ['/service_type'] },
    defaultTtl: -1, // No auto-expiry, but can be enabled later
  });

  container = cont;
  return container;
}

/**
 * Save a service capture to Cosmos DB
 */
export async function saveCapture(capture: ServiceCapture): Promise<string> {
  const cont = await getContainer();
  
  // Generate a unique ID
  const id = `${capture.service_type || 'unknown'}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  
  const document = {
    id,
    ...capture,
    // Ensure partition key exists
    service_type: capture.service_type || 'TFA',
  };

  const { resource } = await cont.items.create(document);
  return resource?.id || id;
}

/**
 * Query captures with optional filters
 * Useful for exports to accounting
 */
export async function queryCaptures(options: QueryOptions = {}): Promise<ServiceCapture[]> {
  const cont = await getContainer();
  
  let query = 'SELECT * FROM c WHERE 1=1';
  const parameters: { name: string; value: any }[] = [];

  if (options.serviceType) {
    query += ' AND c.service_type = @serviceType';
    parameters.push({ name: '@serviceType', value: options.serviceType });
  }

  if (options.startDate) {
    query += ' AND c.captured_at_utc >= @startDate';
    parameters.push({ name: '@startDate', value: options.startDate });
  }

  if (options.endDate) {
    query += ' AND c.captured_at_utc <= @endDate';
    parameters.push({ name: '@endDate', value: options.endDate });
  }

  if (options.userId) {
    query += ' AND c.user_id = @userId';
    parameters.push({ name: '@userId', value: options.userId });
  }

  query += ' ORDER BY c.captured_at_utc DESC';

  const { resources } = await cont.items.query<ServiceCapture>({
    query,
    parameters,
  }).fetchAll();

  return resources;
}

/**
 * Update a capture document
 */
export async function updateCapture(
  id: string,
  serviceType: string,
  updates: Partial<ServiceCapture>
): Promise<ServiceCapture> {
  const cont = await getContainer();
  
  // Use service_type as partition key
  const partitionKey = serviceType || 'TFA';
  
  // Read existing document
  const { resource: existing } = await cont.item(id, partitionKey).read<ServiceCapture>();
  
  if (!existing) {
    throw new Error(`Document not found: ${id}`);
  }
  
  // Merge updates
  const updated = {
    ...existing,
    ...updates,
    id: existing.id, // Preserve ID
    service_type: existing.service_type, // Preserve partition key
  };
  
  // Replace the document
  const { resource } = await cont.item(id, partitionKey).replace(updated);
  
  return resource as ServiceCapture;
}

export type SubmissionStatus = 'New' | 'In Progress' | 'Complete';

export interface ServiceCapture {
  id?: string;
  user_id: string;
  source_url: string;
  captured_at_utc: string;
  received_at_utc: string;
  service_type: string;
  form_data: Record<string, any>;
  // Extracted key fields for easy querying/reporting
  client_id?: string;       // Wellsky client ID - required for linking
  client_name?: string;
  vendor?: string;
  vendor_id?: string;       // NetSuite internal vendor ID
  vendor_account?: string;
  service_amount?: number;
  // SSVF program fields
  region?: 'Shreveport' | 'Monroe' | 'Arkansas';
  program_category?: 'Homeless Prevention' | 'Rapid Rehousing';
  // Workflow status fields
  status?: SubmissionStatus;
  notes?: string;
  updated_by?: string;
  updated_at?: string;
  // Attachments
  attachments?: {
    blobName: string;
    fileName: string;
    contentType: string;
    size: number;
    uploadedAt: string;
    uploadedBy?: string;
  }[];
}

export interface QueryOptions {
  serviceType?: string;
  startDate?: string;
  endDate?: string;
  userId?: string;
}
