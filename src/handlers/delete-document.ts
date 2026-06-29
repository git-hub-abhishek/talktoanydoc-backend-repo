/**
 * DELETE /documents/{documentId}
 *
 * Deletes a document and all its associated vector chunks.
 * Steps:
 *   1. Verify the caller owns the document (DynamoDB GetItem)
 *   2. Delete all OpenSearch chunks for the documentId
 *   3. Delete the DynamoDB record
 *
 * Ownership is checked before any destructive operation — a user cannot
 * delete another user's document even if they know the documentId.
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { ok, serverError, unauthorized, notFound } from '../common/http';
import { getDocument, deleteDocument } from '../common/dynamo';
import { deleteChunksByDocumentId } from '../common/opensearch';
import { logger, setRequestId } from '../common/logger';
import { requireAuth } from '../common/auth';

export async function handler(event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> {
  setRequestId(context.awsRequestId);

  try {
    const user = requireAuth(event);
    const documentId = event.pathParameters?.documentId;

    if (!documentId) {
      return { statusCode: 400, body: JSON.stringify({ message: 'documentId path parameter is required' }), headers: { 'Content-Type': 'application/json' } };
    }

    logger.info('Delete request received', { documentId, userId: user.userId });

    // Ownership check — must happen before any deletion.
    const document = await getDocument(documentId);
    if (!document) {
      logger.warn('Document not found', { documentId });
      return notFound('Document not found');
    }
    if (document.userId !== user.userId) {
      logger.warn('Ownership mismatch on delete', { documentId, requestingUserId: user.userId });
      return unauthorized('You do not have permission to delete this document');
    }

    // Delete chunks first — if this fails the DynamoDB record remains intact
    // and the user can retry. Deleting DynamoDB first would orphan the vectors.
    const chunksDeleted = await deleteChunksByDocumentId(documentId);
    logger.info('OpenSearch chunks deleted', { documentId, chunksDeleted });

    await deleteDocument(documentId);
    logger.info('Document deleted', { documentId, fileName: document.fileName });

    return ok({ documentId, deleted: true });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Unauthorized')) {
      return unauthorized(error.message);
    }
    logger.error('Failed to delete document', error);
    return serverError('Failed to delete document');
  }
}
