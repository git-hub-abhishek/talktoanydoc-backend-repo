import { S3Event, Context } from 'aws-lambda';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { config } from '../common/config';
import { logger, setRequestId } from '../common/logger';
import { extractTextFromBuffer } from '../common/doc-parsers';
import { chunkText } from '../common/chunker';
import { embedText } from '../common/bedrock';
import { ensureIndex, upsertChunkDocument } from '../common/opensearch';
import { updateDocumentStatus } from '../common/dynamo';
import { getIngestConfig } from '../common/ssm';

const s3 = new S3Client({ region: config.awsRegion });

export async function handler(event: S3Event, context: Context): Promise<void> {
  setRequestId(context.awsRequestId);

  for (const record of event.Records) {
    const bucket = record.s3.bucket.name;
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
    const documentId = key.split('/')[1];
    const fileName = key.split('/').slice(2).join('/');

    logger.info('Starting ingestion', { bucket, key, documentId, fileName });
    await updateDocumentStatus(documentId, 'INGESTING');

    try {
      logger.info('Downloading file from S3', { bucket, key });
      const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const bytes = await object.Body?.transformToByteArray();
      const buffer = Buffer.from(bytes || []);
      logger.info('File downloaded', { sizeBytes: buffer.length });

      logger.info('Extracting text', { fileName });
      const text = await extractTextFromBuffer(fileName, buffer);
      logger.info('Text extracted', { charCount: text.length });

      const ingestConfig = await getIngestConfig();
      const chunks = chunkText(documentId, text, ingestConfig.chunkSize, ingestConfig.overlap);
      logger.info('Text chunked', { chunkCount: chunks.length, chunkSize: ingestConfig.chunkSize, overlap: ingestConfig.overlap });

      await ensureIndex();

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        logger.info('Embedding chunk', { chunkIndex: i + 1, total: chunks.length, chunkId: chunk.chunkId });
        const vector = await embedText(chunk.text);
        await upsertChunkDocument({ documentId, chunkId: chunk.chunkId, fileName, text: chunk.text, vector });
      }

      await updateDocumentStatus(documentId, 'READY');
      logger.info('Ingestion completed', { documentId, chunkCount: chunks.length });
    } catch (error) {
      logger.error('Ingestion failed', error);
      await updateDocumentStatus(documentId, 'FAILED');
      throw error;
    }
  }
}
