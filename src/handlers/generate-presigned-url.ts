/**
 * GET /generate-url — generate an S3 pre-signed PUT URL for direct browser upload.
 *
 * Flow:
 *   1. Validate the Cognito JWT (via API Gateway Cognito Authorizer).
 *   2. Validate fileName, contentType (MIME), and fileSize against allowed types / max size.
 *   3. Generate a UUID as the documentId.
 *   4. Create a pre-signed S3 PutObject URL with Content-Type and Content-Length conditions
 *      so the browser can upload directly without going through the API.
 *   5. Return the URL, documentId, and constraints to the frontend.
 *
 * The frontend uses the returned documentId when calling POST /documents/register.
 * S3 key format: uploads/{documentId}/{sanitisedFileName}
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuid } from 'uuid';
import { config } from '../common/config';
import { badRequest, ok, serverError, unauthorized } from '../common/http';
import { logger, setRequestId } from '../common/logger';
import { requireAuth } from '../common/auth';

const s3 = new S3Client({ region: config.awsRegion });

const ALLOWED_CONTENT_TYPES = [
  'application/pdf',
  'application/msword',                                                      // .doc
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document' // .docx
];

const ALLOWED_EXTENSIONS = ['.pdf', '.doc', '.docx'];

export async function handler(event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> {
  setRequestId(context.awsRequestId);
  try {
    const user = requireAuth(event);
    logger.info('Generating presigned URL for user', { userId: user.userId });

    const fileName = event.queryStringParameters?.fileName;
    const contentType = event.queryStringParameters?.contentType;
    const fileSizeStr = event.queryStringParameters?.fileSize;

    if (!fileName)     return badRequest('fileName is required');
    if (!contentType)  return badRequest('contentType is required');
    if (!fileSizeStr)  return badRequest('fileSize is required');

    if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
      return badRequest(`Invalid file type. Only PDF and DOC/DOCX files are allowed. Received: ${contentType}`);
    }

    const fileExtension = fileName.toLowerCase().substring(fileName.lastIndexOf('.'));
    if (!ALLOWED_EXTENSIONS.includes(fileExtension)) {
      return badRequest(`Invalid file extension. Only ${ALLOWED_EXTENSIONS.join(', ')} files are allowed. Received: ${fileExtension}`);
    }

    const fileSizeBytes = parseInt(fileSizeStr, 10);
    if (isNaN(fileSizeBytes) || fileSizeBytes <= 0) {
      return badRequest('fileSize must be a positive number (bytes)');
    }

    const maxSizeBytes = config.maxUploadSizeMb * 1024 * 1024;
    if (fileSizeBytes > maxSizeBytes) {
      return badRequest(`File size exceeds maximum allowed size of ${config.maxUploadSizeMb}MB. Received: ${(fileSizeBytes / 1024 / 1024).toFixed(2)}MB`);
    }

    const documentId = uuid();
    const fileKey = `uploads/${documentId}/${sanitiseFileName(fileName)}`;

    // Embed Content-Type and Content-Length in the pre-signed URL conditions so
    // S3 rejects uploads that don't match — prevents type or size smuggling.
    const command = new PutObjectCommand({
      Bucket: config.uploadBucket,
      Key: fileKey,
      ContentType: contentType,
      ContentLength: fileSizeBytes,
      Metadata: {
        'original-filename': fileName,
        'user-id': user.userId,
        'upload-timestamp': new Date().toISOString()
      }
    });

    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: config.signedUrlExpirySeconds });

    logger.info('Pre-signed URL generated', { userId: user.userId, documentId, fileName, contentType, fileSizeBytes });

    return ok({ uploadUrl, fileKey, documentId, expiresIn: config.signedUrlExpirySeconds, maxSizeBytes, allowedTypes: ALLOWED_CONTENT_TYPES });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Unauthorized')) {
      return unauthorized(error.message);
    }
    logger.error('Failed to generate pre-signed URL', error);
    return serverError('Failed to generate upload URL');
  }
}

/** Replace any character that is not alphanumeric, dot, hyphen, or underscore. */
function sanitiseFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_');
}
