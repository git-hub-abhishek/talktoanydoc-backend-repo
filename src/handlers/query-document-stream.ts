import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { logger, setRequestId } from '../common/logger';
import { getDocument } from '../common/dynamo';
import { embedText, answerQuestionStream } from '../common/bedrock';
import { searchRelevantChunks } from '../common/opensearch';
import { config } from '../common/config';

const verifier = CognitoJwtVerifier.create({
  userPoolId: config.cognitoUserPoolId,
  tokenUse: 'id',
  clientId: config.cognitoClientId,
});

export const handler = awslambda.streamifyResponse(
  async (event: any, responseStream: any, context: any) => {
    setRequestId(context.awsRequestId);
    logger.info('Stream query started');

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

      logger.info('Searching OpenSearch', { documentId: body.documentId });
      const hits = await searchRelevantChunks(body.documentId, queryVector, 5);
      logger.info('OpenSearch results', { hitCount: hits.length });

      const sources = hits.map(h => ({ chunkId: h.chunkId, title: h.fileName }));
      send({ type: 'sources', sources });

      logger.info('Starting Bedrock stream', { model: config.bedrockChatModelId, guardrailId: config.guardrailId });
      let deltaCount = 0;
      for await (const text of answerQuestionStream(body.question, hits.map(h => h.text))) {
        send({ type: 'delta', text });
        deltaCount++;
      }

      // If the guardrail blocked the response, deltaCount will be 0 and no text
      // was streamed. Send the configured blocked-output message to the frontend.
      if (deltaCount === 0) {
        logger.warn('No tokens streamed — guardrail likely intervened');
        send({ type: 'delta', text: 'The response was blocked because it did not meet content or grounding requirements. Please try a different question.' });
      }

      send({ type: 'done' });
      logger.info('Stream completed', { deltaCount });
    } catch (error) {
      logger.error('Streaming query failed', error);
      responseStream.write(JSON.stringify({ error: 'Failed to answer question' }) + '\n');
    } finally {
      responseStream.end();
    }
  }
);
