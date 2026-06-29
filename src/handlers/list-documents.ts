/**
 * GET /documents — list all documents owned by the authenticated user.
 *
 * Queries the DynamoDB userId-index GSI to fetch only the calling user's
 * documents. Results are sorted newest-first by uploadedAt before returning.
 *
 * The frontend polls this endpoint while any document is in a pending status
 * (UPLOADING, REGISTERED, INGESTING) to update the UI when ingestion completes.
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { ok, serverError, unauthorized } from '../common/http';
import { listDocumentsByUser } from '../common/dynamo';
import { logger, setRequestId } from '../common/logger';
import { requireAuth } from '../common/auth';

export async function handler(event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> {
  setRequestId(context.awsRequestId);
  try {
    const user = requireAuth(event);
    logger.info('Listing documents for user', { userId: user.userId });

    const documents = await listDocumentsByUser(user.userId);

    // Sort newest-first so the frontend displays the most recent upload at the top.
    const sorted = documents.sort((a, b) =>
      new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
    );

    logger.info('Documents listed', { userId: user.userId, count: sorted.length });
    return ok(sorted);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Unauthorized')) {
      return unauthorized(error.message);
    }
    logger.error('Failed to list documents', error);
    return serverError('Failed to list documents');
  }
}
