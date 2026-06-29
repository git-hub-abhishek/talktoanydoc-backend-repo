/**
 * Streaming RAG query with reranking — Lambda Function URL (RESPONSE_STREAM).
 *
 * Extends the standard streaming pipeline with a reranking step between
 * OpenSearch retrieval and the final LLM call:
 *
 *   1. Validate JWT
 *   2. Verify document ownership (DynamoDB)
 *   3. Embed question (Titan Embed Text v2)
 *   4. KNN search — fetch top 20 candidates (vs 5 in standard pipeline)
 *   5. Rerank — score each candidate with Claude Haiku, keep top 5
 *   6. Stream answer — Claude Sonnet 4.6 with Guardrail
 *   7. Return NDJSON stream with sources and token deltas
 *
 * The wider initial retrieval (20 candidates) gives the reranker more material
 * to choose from, which improves answer quality for longer documents where the
 * top-5 KNN results may miss the most relevant passage.
 */

import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { logger, setRequestId } from '../common/logger';
import { getDocument } from '../common/dynamo';
import { embedText, rerankChunks, answerQuestionStream } from '../common/bedrock';
import { searchRelevantChunks, expandWithNeighbours } from '../common/opensearch';
import { config } from '../common/config';

const verifier = CognitoJwtVerifier.create({
  userPoolId: config.cognitoUserPoolId,
  tokenUse: 'id',
  clientId: config.cognitoClientId,
});

export const handler = awslambda.streamifyResponse(
  async (event: any, responseStream: any, context: any) => {
    setRequestId(context.awsRequestId);
    logger.info('Reranked stream query started');

    const send = (obj: object) => {
      responseStream.write(JSON.stringify(obj) + '\n');
    };

    try {
      const authHeader: string | undefined =
        event.headers?.Authorization ?? event.headers?.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        logger.warn('Missing or invalid Authorization header');
        send({ error: 'Unauthorized' });
        responseStream.end();
        return;
      }

      logger.info('Verifying JWT');
      const token = authHeader.slice(7);
      const payload = await verifier.verify(token);
      const userId = payload.sub;
      logger.info('JWT verified', { userId });

      const body = JSON.parse(event.body ?? '{}') as {
        question?: string;
        documentId?: string;
      };

      if (!body.question || !body.documentId) {
        logger.warn('Missing required fields', { hasQuestion: !!body.question, hasDocumentId: !!body.documentId });
        send({ error: 'question and documentId are required' });
        responseStream.end();
        return;
      }

      logger.info('Fetching document', { documentId: body.documentId });
      const document = await getDocument(body.documentId);
      if (!document) {
        logger.warn('Document not found', { documentId: body.documentId });
        send({ error: 'Document not found' });
        responseStream.end();
        return;
      }
      if (document.userId !== userId) {
        logger.warn('Document ownership mismatch', { documentId: body.documentId, userId });
        send({ error: 'Unauthorized' });
        responseStream.end();
        return;
      }
      if (document.status !== 'READY') {
        logger.warn('Document not ready', { documentId: body.documentId, status: document.status });
        send({ error: `Document is not ready. Current status: ${document.status}` });
        responseStream.end();
        return;
      }

      logger.info('Embedding question');
      const queryVector = await embedText(body.question);

      // Fetch a wider candidate set (20) so the reranker has more to choose from.
      logger.info('Searching OpenSearch — wide retrieval for reranking', { documentId: body.documentId, k: 20 });
      const candidates = await searchRelevantChunks(body.documentId, queryVector, 20);
      logger.info('OpenSearch candidates', { count: candidates.length });

      // Rerank candidates with Claude Haiku and keep top 5.
      logger.info('Reranking candidates with Claude Haiku', { candidates: candidates.length, topN: 5 });
      const topIndices = await rerankChunks(body.question, candidates, 5);
      const reranked = topIndices.map(i => candidates[i]);
      logger.info('Reranking complete', { selectedIndices: topIndices });

      // Expand each reranked chunk with its immediate neighbours so that
      // multi-chunk passages (e.g. long activities) are not truncated mid-sentence.
      const hits = await expandWithNeighbours(reranked);
      logger.info('After neighbour expansion', { totalChunks: hits.length });

      const sources = hits.map(h => ({ chunkId: h.chunkId, title: h.fileName }));
      send({ type: 'sources', sources });

      logger.info('Starting Bedrock stream', { model: config.bedrockChatModelId, guardrailId: config.guardrailId });
      let deltaCount = 0;
      for await (const text of answerQuestionStream(body.question, hits.map(h => h.text))) {
        send({ type: 'delta', text });
        deltaCount++;
      }

      if (deltaCount === 0) {
        logger.warn('No tokens streamed — guardrail likely intervened');
        send({ type: 'delta', text: 'The response was blocked because it did not meet content or grounding requirements. Please try a different question.' });
      }

      send({ type: 'done' });
      logger.info('Reranked stream completed', { deltaCount });
    } catch (error) {
      logger.error('Reranked streaming query failed', error);
      responseStream.write(JSON.stringify({ error: 'Failed to answer question' }) + '\n');
    } finally {
      responseStream.end();
    }
  }
);
