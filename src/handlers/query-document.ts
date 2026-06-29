/**
 * POST /query — non-streaming RAG query over an ingested document.
 *
 * This is the legacy API Gateway route kept for compatibility. New clients
 * should use the streaming Lambda Function URL (query-document-stream.ts)
 * which delivers tokens progressively for a better user experience.
 *
 * Flow:
 *   1. Validate the Cognito JWT (API Gateway Cognito Authorizer).
 *   2. Fetch the document from DynamoDB and verify ownership.
 *   3. Embed the question with Bedrock Titan Embed Text v2.
 *   4. Run a KNN search on OpenSearch (k=5, filtered by documentId).
 *   5. Send the retrieved chunks + question to Claude Sonnet 4.6 with Guardrail.
 *   6. Return the answer and source citations.
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { badRequest, ok, serverError, unauthorized } from '../common/http';
import { logger, setRequestId } from '../common/logger';
import { getDocument } from '../common/dynamo';
import { embedText, answerQuestion } from '../common/bedrock';
import { searchRelevantChunks } from '../common/opensearch';
import { requireAuth } from '../common/auth';

export async function handler(event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> {
  setRequestId(context.awsRequestId);
  try {
    const user = requireAuth(event);
    logger.info('Processing query for user', { userId: user.userId });

    if (!event.body) return badRequest('Request body is required');

    const payload = JSON.parse(event.body) as {
      question?: string;
      documentId?: string;
      sessionId?: string;
    };

    if (!payload.question || !payload.documentId) {
      return badRequest('question and documentId are required');
    }

    const document = await getDocument(payload.documentId);
    if (!document) return badRequest('Document not found');

    // Ownership check — prevent users from querying other users' documents.
    if (document.userId !== user.userId) {
      return unauthorized('You do not have access to this document');
    }

    if (document.status !== 'READY') {
      return badRequest(`Document is not ready. Current status: ${document.status}`);
    }

    logger.info('Embedding question');
    const queryVector = await embedText(payload.question);

    logger.info('Searching OpenSearch', { documentId: payload.documentId });
    const hits = await searchRelevantChunks(payload.documentId, queryVector, 5);
    logger.info('OpenSearch results', { hitCount: hits.length });

    logger.info('Invoking Bedrock', { model: 'claude-sonnet-4-6' });
    const answer = await answerQuestion(payload.question, hits.map((hit) => hit.text));

    return ok({
      answer,
      sources: hits.map((hit) => ({ chunkId: hit.chunkId, title: hit.fileName }))
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Unauthorized')) {
      return unauthorized(error.message);
    }
    logger.error('Query failed', error);
    return serverError('Failed to answer question');
  }
}
