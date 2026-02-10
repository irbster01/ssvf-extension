import {
  BlobServiceClient,
  ContainerClient,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
  BlobSASPermissions,
  SASProtocol,
} from '@azure/storage-blob';

const CONTAINER_NAME = 'tfa-attachments';

let containerClient: ContainerClient | null = null;

export interface AttachmentMeta {
  blobName: string;
  fileName: string;
  contentType: string;
  size: number;
  uploadedAt: string;
  uploadedBy?: string;
}

function getStorageConfig() {
  const connectionString = process.env.BLOB_STORAGE_CONNECTION_STRING;
  if (!connectionString) {
    throw new Error('BLOB_STORAGE_CONNECTION_STRING environment variable is required');
  }
  return connectionString;
}

function getContainerClient(): ContainerClient {
  if (containerClient) return containerClient;
  const connStr = getStorageConfig();
  const blobService = BlobServiceClient.fromConnectionString(connStr);
  containerClient = blobService.getContainerClient(CONTAINER_NAME);
  return containerClient;
}

/**
 * Upload a file buffer to blob storage
 * Returns the blob name (path) for storage in Cosmos DB
 */
export async function uploadAttachment(
  submissionId: string,
  fileName: string,
  contentType: string,
  buffer: Buffer,
  uploadedBy?: string
): Promise<AttachmentMeta> {
  const container = getContainerClient();

  // Sanitize filename and create unique blob name
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const blobName = `${submissionId}/${Date.now()}_${safeName}`;

  const blockBlobClient = container.getBlockBlobClient(blobName);
  await blockBlobClient.upload(buffer, buffer.length, {
    blobHTTPHeaders: {
      blobContentType: contentType,
      blobContentDisposition: `attachment; filename="${fileName}"`,
    },
  });

  return {
    blobName,
    fileName,
    contentType,
    size: buffer.length,
    uploadedAt: new Date().toISOString(),
    uploadedBy,
  };
}

/**
 * Generate a short-lived SAS URL for downloading an attachment
 */
export async function getAttachmentDownloadUrl(blobName: string): Promise<string> {
  const connStr = getStorageConfig();
  const blobService = BlobServiceClient.fromConnectionString(connStr);
  const container = blobService.getContainerClient(CONTAINER_NAME);
  const blobClient = container.getBlobClient(blobName);

  // Parse account name and key from connection string
  const accountName = connStr.match(/AccountName=([^;]+)/)?.[1];
  const accountKey = connStr.match(/AccountKey=([^;]+)/)?.[1];

  if (!accountName || !accountKey) {
    throw new Error('Could not parse storage account credentials');
  }

  const sharedKeyCredential = new StorageSharedKeyCredential(accountName, accountKey);

  const sasToken = generateBlobSASQueryParameters(
    {
      containerName: CONTAINER_NAME,
      blobName,
      permissions: BlobSASPermissions.parse('r'),
      startsOn: new Date(Date.now() - 5 * 60 * 1000), // 5 min ago
      expiresOn: new Date(Date.now() + 60 * 60 * 1000), // 1 hour from now
      protocol: SASProtocol.Https,
    },
    sharedKeyCredential
  ).toString();

  return `${blobClient.url}?${sasToken}`;
}

/**
 * Delete a blob attachment
 */
export async function deleteAttachment(blobName: string): Promise<void> {
  const container = getContainerClient();
  const blobClient = container.getBlobClient(blobName);
  await blobClient.deleteIfExists();
}
