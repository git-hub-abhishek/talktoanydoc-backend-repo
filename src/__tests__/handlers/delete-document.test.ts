jest.mock('../../common/dynamo');
jest.mock('../../common/opensearch');
jest.mock('../../common/logger', () => ({
  setRequestId: jest.fn(),
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { handler } from '../../handlers/delete-document';
import { getDocument, deleteDocument } from '../../common/dynamo';
import { deleteChunksByDocumentId } from '../../common/opensearch';
import type { APIGatewayProxyEvent, Context } from 'aws-lambda';
import type { DocumentRecord } from '../../types/document';

const mockGetDocument = getDocument as jest.MockedFunction<typeof getDocument>;
const mockDeleteDocument = deleteDocument as jest.MockedFunction<typeof deleteDocument>;
const mockDeleteChunks = deleteChunksByDocumentId as jest.MockedFunction<typeof deleteChunksByDocumentId>;

const CONTEXT = { awsRequestId: 'test-req-id' } as Context;

function makeEvent(documentId: string | undefined, userId: string): APIGatewayProxyEvent {
  return {
    pathParameters: documentId ? { documentId } : null,
    requestContext: {
      authorizer: {
        claims: { sub: userId, email: 'user@test.com', 'cognito:username': 'testuser' },
      },
    },
  } as unknown as APIGatewayProxyEvent;
}

function makeDoc(documentId: string, userId: string): DocumentRecord {
  return {
    documentId,
    fileKey: `uploads/${documentId}/file.pdf`,
    fileName: 'file.pdf',
    size: 1024,
    type: 'application/pdf',
    status: 'READY',
    uploadedAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    userId,
  };
}

beforeEach(() => {
  mockGetDocument.mockReset();
  mockDeleteDocument.mockReset();
  mockDeleteChunks.mockReset();
});

describe('DELETE /documents/{documentId} handler', () => {
  it('returns 400 when documentId path parameter is missing', async () => {
    const res = await handler(makeEvent(undefined, 'user-1'), CONTEXT);
    expect(res.statusCode).toBe(400);
  });

  it('returns 401 when no auth context is present', async () => {
    const event = {
      pathParameters: { documentId: 'doc-1' },
      requestContext: { authorizer: undefined },
    } as unknown as APIGatewayProxyEvent;
    const res = await handler(event, CONTEXT);
    expect(res.statusCode).toBe(401);
  });

  it('returns 404 when document does not exist', async () => {
    mockGetDocument.mockResolvedValue(undefined);
    const res = await handler(makeEvent('doc-1', 'user-1'), CONTEXT);
    expect(res.statusCode).toBe(404);
  });

  it('returns 401 when requester does not own the document', async () => {
    mockGetDocument.mockResolvedValue(makeDoc('doc-1', 'owner-user'));
    const res = await handler(makeEvent('doc-1', 'different-user'), CONTEXT);
    expect(res.statusCode).toBe(401);
  });

  it('deletes OpenSearch chunks before DynamoDB record', async () => {
    const callOrder: string[] = [];
    mockGetDocument.mockResolvedValue(makeDoc('doc-1', 'user-1'));
    mockDeleteChunks.mockImplementation(async () => { callOrder.push('opensearch'); return 5; });
    mockDeleteDocument.mockImplementation(async () => { callOrder.push('dynamo'); });

    await handler(makeEvent('doc-1', 'user-1'), CONTEXT);
    expect(callOrder).toEqual(['opensearch', 'dynamo']);
  });

  it('returns 200 with documentId and deleted:true on success', async () => {
    mockGetDocument.mockResolvedValue(makeDoc('doc-1', 'user-1'));
    mockDeleteChunks.mockResolvedValue(3);
    mockDeleteDocument.mockResolvedValue(undefined);

    const res = await handler(makeEvent('doc-1', 'user-1'), CONTEXT);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toEqual({ documentId: 'doc-1', deleted: true });
  });

  it('returns 500 when OpenSearch deletion throws', async () => {
    mockGetDocument.mockResolvedValue(makeDoc('doc-1', 'user-1'));
    mockDeleteChunks.mockRejectedValue(new Error('OpenSearch error'));

    const res = await handler(makeEvent('doc-1', 'user-1'), CONTEXT);
    expect(res.statusCode).toBe(500);
  });

  it('does not delete DynamoDB record if OpenSearch throws', async () => {
    mockGetDocument.mockResolvedValue(makeDoc('doc-1', 'user-1'));
    mockDeleteChunks.mockRejectedValue(new Error('OpenSearch error'));

    await handler(makeEvent('doc-1', 'user-1'), CONTEXT);
    expect(mockDeleteDocument).not.toHaveBeenCalled();
  });
});
