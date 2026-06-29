/**
 * POST /documents/register — save document metadata to DynamoDB after S3 upload.
 *
 * Flow:
 *   1. Validate the Cognito JWT.
 *   2. Parse and validate the request body.
 *   3. Write a DocumentRecord with status REGISTERED to DynamoDB.
 *
 * This is called by the frontend immediately after the direct S3 upload succeeds.
 * The S3 ObjectCreated event will trigger IngestDocumentFunction asynchronously —
 * this endpoint only persists metadata so the frontend can poll for status.
 *
 * The documentId is provided by the frontend (returned from /generate-url) to
 * keep the S3 key and DynamoDB record in sync.
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { badRequest, ok, serverError, unauthorized } from '../common/http';
import { putDocument } from '../common/dynamo';
import { logger, setRequestId } from '../common/logger';
import { DocumentRecord } from '../types/document';
import { requireAuth } from '../common/auth';

export async function handler(event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> {
  setRequestId(context.awsRequestId);
  try {
    const user = requireAuth(event);
    logger.info('Registering document for user', { userId: user.userId });

    if (!event.body) return badRequest('Request body is required');

    const payload = JSON.parse(event.body) as {
      fileKey?: string;
      fileName?: string;
      size?: number;
      type?: string;
      documentId?: string;
    };

    if (!payload.fileKey || !payload.fileName || payload.size === undefined || !payload.type) {
      return badRequest('fileKey, fileName, size and type are required');
    }

    // documentId is provided by the frontend from /generate-url; fall back to
    // parsing it from the fileKey for backwards compatibility.
    const documentId = payload.documentId || payload.fileKey.split('/')[1];
    const now = new Date().toISOString();

    const record: DocumentRecord = {
      documentId,
      fileKey: payload.fileKey,
      fileName: payload.fileName,
      size: payload.size,
      type: payload.type,
      status: 'REGISTERED',
      uploadedAt: now,
      updatedAt: now,
      userId: user.userId
    };

    await putDocument(record);
    logger.info('Document registered', { documentId, fileName: payload.fileName });
    return ok({ documentId, status: 'REGISTERED' });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Unauthorized')) {
      return unauthorized(error.message);
    }
    logger.error('Failed to register document', error);
    return serverError('Failed to register document');
  }
}
