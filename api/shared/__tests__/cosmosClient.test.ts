/**
 * Tests for cosmosClient query building and pagination logic.
 * Mocks @azure/cosmos to verify queries are constructed correctly.
 */

// Mock the Cosmos DB SDK before importing the module
const mockFetchAll = jest.fn();
const mockQuery = jest.fn(() => ({ fetchAll: mockFetchAll }));
const mockCreate = jest.fn();
const mockRead = jest.fn();
const mockReplace = jest.fn();
const mockItem = jest.fn(() => ({ read: mockRead, replace: mockReplace }));

const mockContainer = {
  items: {
    query: mockQuery,
    create: mockCreate,
  },
  item: mockItem,
};

const mockCreateIfNotExists = jest.fn(() =>
  Promise.resolve({ container: mockContainer })
);

const mockDbCreateIfNotExists = jest.fn(() =>
  Promise.resolve({
    database: {
      containers: { createIfNotExists: mockCreateIfNotExists },
    },
  })
);

jest.mock('@azure/cosmos', () => ({
  CosmosClient: jest.fn(() => ({
    databases: { createIfNotExists: mockDbCreateIfNotExists },
  })),
}));

// Set env vars before import
process.env.COSMOS_ENDPOINT = 'https://test.documents.azure.com';
process.env.COSMOS_KEY = 'dGVzdGtleQ==';
process.env.COSMOS_DATABASE = 'test-db';
process.env.COSMOS_CONTAINER = 'test-container';

import {
  queryCaptures,
  queryCapturesPaginated,
  saveCapture,
  updateCapture,
  ServiceCapture,
  QueryOptions,
} from '../cosmosClient';

describe('cosmosClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchAll.mockResolvedValue({ resources: [] });
  });

  describe('queryCaptures', () => {
    it('builds a query with no filters', async () => {
      mockFetchAll.mockResolvedValue({ resources: [] });
      await queryCaptures();

      expect(mockQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.stringContaining('SELECT * FROM c WHERE 1=1'),
          parameters: [],
        })
      );
    });

    it('includes service type filter', async () => {
      await queryCaptures({ serviceType: 'TFA' });

      const call = mockQuery.mock.calls[0][0];
      expect(call.query).toContain('c.service_type = @serviceType');
      expect(call.parameters).toContainEqual({ name: '@serviceType', value: 'TFA' });
    });

    it('includes date range filters', async () => {
      await queryCaptures({ startDate: '2024-01-01', endDate: '2024-12-31' });

      const call = mockQuery.mock.calls[0][0];
      expect(call.query).toContain('c.captured_at_utc >= @startDate');
      expect(call.query).toContain('c.captured_at_utc <= @endDate');
      expect(call.parameters).toContainEqual({ name: '@startDate', value: '2024-01-01' });
      expect(call.parameters).toContainEqual({ name: '@endDate', value: '2024-12-31' });
    });

    it('includes userId filter with case-insensitive match', async () => {
      await queryCaptures({ userId: 'User@Test.COM' });

      const call = mockQuery.mock.calls[0][0];
      expect(call.query).toContain('LOWER(c.user_id) = LOWER(@userId)');
      expect(call.parameters).toContainEqual({ name: '@userId', value: 'User@Test.COM' });
    });

    it('applies default pagination (offset 0, limit 200)', async () => {
      await queryCaptures();

      const call = mockQuery.mock.calls[0][0];
      expect(call.query).toContain('OFFSET 0 LIMIT 200');
    });

    it('applies custom pagination', async () => {
      await queryCaptures({ limit: 50, offset: 100 });

      const call = mockQuery.mock.calls[0][0];
      expect(call.query).toContain('OFFSET 100 LIMIT 50');
    });

    it('orders by captured_at_utc DESC', async () => {
      await queryCaptures();

      const call = mockQuery.mock.calls[0][0];
      expect(call.query).toContain('ORDER BY c.captured_at_utc DESC');
    });
  });

  describe('queryCapturesPaginated', () => {
    it('returns pagination metadata', async () => {
      // First call = count query, second = data query
      mockFetchAll
        .mockResolvedValueOnce({ resources: [42] }) // count
        .mockResolvedValueOnce({ resources: [{ id: '1' }, { id: '2' }] }); // data

      const result = await queryCapturesPaginated({ limit: 2, offset: 0 });

      expect(result.totalCount).toBe(42);
      expect(result.items).toHaveLength(2);
      expect(result.offset).toBe(0);
      expect(result.limit).toBe(2);
      expect(result.hasMore).toBe(true);
    });

    it('sets hasMore=false when all items returned', async () => {
      mockFetchAll
        .mockResolvedValueOnce({ resources: [3] }) // totalCount=3
        .mockResolvedValueOnce({ resources: [{ id: '1' }, { id: '2' }, { id: '3' }] });

      const result = await queryCapturesPaginated({ limit: 10, offset: 0 });

      expect(result.hasMore).toBe(false);
    });

    it('issues a COUNT query alongside data query', async () => {
      mockFetchAll
        .mockResolvedValueOnce({ resources: [0] })
        .mockResolvedValueOnce({ resources: [] });

      await queryCapturesPaginated();

      // Should have been called twice: once for count, once for data
      expect(mockQuery).toHaveBeenCalledTimes(2);
      const countCall = mockQuery.mock.calls[0][0];
      expect(countCall.query).toContain('SELECT VALUE COUNT(1)');
    });
  });

  describe('saveCapture', () => {
    it('generates an ID and creates a document', async () => {
      mockCreate.mockResolvedValue({ resource: { id: 'test-id' } });

      const capture: ServiceCapture = {
        user_id: 'user@test.com',
        source_url: 'https://example.com',
        captured_at_utc: '2024-01-01T00:00:00Z',
        received_at_utc: '2024-01-01T00:00:01Z',
        service_type: 'TFA',
        form_data: { field: 'value' },
      };

      const id = await saveCapture(capture);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 'user@test.com',
          service_type: 'TFA',
        })
      );
      expect(id).toBe('test-id');
    });

    it('defaults service_type to TFA', async () => {
      mockCreate.mockResolvedValue({ resource: { id: 'x' } });

      const capture = {
        user_id: 'u',
        source_url: 'https://x.com',
        captured_at_utc: '2024-01-01T00:00:00Z',
        received_at_utc: '2024-01-01T00:00:01Z',
        service_type: '',
        form_data: {},
      };

      await saveCapture(capture);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ service_type: 'TFA' })
      );
    });
  });

  describe('updateCapture', () => {
    it('reads then replaces a document, preserving id and partition key', async () => {
      const existing: Partial<ServiceCapture> = {
        id: 'doc-1',
        service_type: 'TFA',
        user_id: 'user@test.com',
        source_url: 'https://x.com',
        captured_at_utc: '2024-01-01',
        received_at_utc: '2024-01-01',
        status: 'New',
        form_data: {},
      };
      mockRead.mockResolvedValue({ resource: existing });
      mockReplace.mockResolvedValue({ resource: { ...existing, status: 'Submitted' } });

      const result = await updateCapture('doc-1', 'TFA', { status: 'Submitted' });

      expect(mockItem).toHaveBeenCalledWith('doc-1', 'TFA');
      expect(mockReplace).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'doc-1',
          service_type: 'TFA',
          status: 'Submitted',
        })
      );
      expect(result.status).toBe('Submitted');
    });
  });
});
