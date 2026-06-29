/**
 * OpenSearch Serverless client — vector upsert and KNN search.
 *
 * Uses AWS SigV4 signing (service: 'aoss') because OpenSearch Serverless does
 * not accept username/password authentication — all requests must be signed with
 * IAM credentials. The Lambda execution role must have both aoss:APIAccessAll
 * (IAM policy) and be listed as a Principal in the collection's data access policy.
 *
 * ensureIndex() is called once per ingestion before the first upsert. It is a
 * no-op if the index already exists, so it is safe to call on every invocation.
 * The vector field must be mapped as knn_vector at index creation time — it cannot
 * be changed on an existing index without deleting and recreating it.
 */

import { Client } from '@opensearch-project/opensearch';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { config } from './config';
import { SearchHit } from '../types/document';

const client = new Client({
  ...AwsSigv4Signer({
    region: config.awsRegion,
    service: 'aoss',
    getCredentials: defaultProvider()
  }),
  node: config.openSearchEndpoint
});

/**
 * Create the vector index with the correct knn_vector mapping if it does not
 * already exist. Must be called before the first upsert in every ingestion.
 *
 * Index settings:
 *   - knn: true            — required to enable KNN queries on this index
 *   - HNSW / cosinesimil   — approximate nearest-neighbour algorithm
 *   - dimension: 1024      — matches Titan Embed Text v2 output size
 *
 * The 'engine' parameter is intentionally omitted — OpenSearch Serverless
 * manages the underlying engine internally and rejects the field if supplied.
 */
export async function ensureIndex(): Promise<void> {
  const exists = await client.indices.exists({ index: config.vectorIndex });
  if (exists.body) return;

  await client.indices.create({
    index: config.vectorIndex,
    body: {
      settings: {
        index: { knn: true }
      },
      mappings: {
        properties: {
          documentId: { type: 'keyword' },  // filter field — scopes KNN search to one document
          chunkId:    { type: 'keyword' },  // upsert key — enables idempotent re-ingestion
          fileName:   { type: 'keyword' },  // returned as citation source in query response
          text:       { type: 'text' },     // raw chunk content returned to the LLM as context
          vector: {
            type: 'knn_vector',
            dimension: 1024,
            method: {
              name: 'hnsw',
              space_type: 'cosinesimil'     // cosine similarity matches Titan's embedding space
            }
          }
        }
      }
    }
  });
}

/**
 * Upsert a single document chunk into the vector index.
 * Uses the chunkId as the document _id so re-ingesting the same document
 * overwrites existing chunks rather than creating duplicates.
 *
 * The refresh parameter is omitted — OpenSearch Serverless does not support
 * explicit refresh policies and rejects requests that include one.
 */
export async function upsertChunkDocument(input: {
  documentId: string;
  chunkId: string;
  fileName: string;
  text: string;
  vector: number[];
}): Promise<void> {
  await client.index({
    index: config.vectorIndex,
    id: input.chunkId,
    body: input
  });
}

/**
 * Fetch specific chunks by their chunkIds using a terms query.
 * Used by expandWithNeighbours to retrieve adjacent chunks that were not
 * returned by the KNN search but are needed for context continuity.
 */
export async function fetchChunksByIds(chunkIds: string[]): Promise<SearchHit[]> {
  if (chunkIds.length === 0) return [];

  const result = await client.search({
    index: config.vectorIndex,
    body: {
      size: chunkIds.length,
      query: { terms: { chunkId: chunkIds } }
    }
  });

  const hits = ((result as any).body?.hits?.hits || (result as any).hits?.hits || []) as Array<any>;
  return hits.map((hit) => ({
    chunkId:    hit._source.chunkId,
    documentId: hit._source.documentId,
    fileName:   hit._source.fileName,
    text:       hit._source.text,
    score:      hit._score
  }));
}

/**
 * Expand a set of KNN hits with their immediate neighbours (prev + next chunk).
 *
 * ChunkIds are formatted as "{documentId}#{index}". For each selected chunk we
 * derive the IDs of the chunk before and after it, fetch any that aren't already
 * in the selected set, and merge them in document order.
 *
 * This is critical for multi-chunk passages (e.g. long activities, tables, lists)
 * where the most relevant chunk is semantically similar to the query but the
 * answer text actually spans into adjacent chunks.
 *
 * @param hits - KNN-retrieved chunks to expand.
 * @returns    Deduplicated, index-ordered array including all neighbours.
 */
export async function expandWithNeighbours(hits: SearchHit[]): Promise<SearchHit[]> {
  const existingIds = new Set(hits.map(h => h.chunkId));

  // Derive neighbour IDs from the "{documentId}#{index}" format.
  const neighbourIds: string[] = [];
  for (const hit of hits) {
    const parts = hit.chunkId.split('#');
    const idx = parseInt(parts[parts.length - 1], 10);
    const prefix = parts.slice(0, -1).join('#');
    if (idx > 0) neighbourIds.push(`${prefix}#${idx - 1}`);
    neighbourIds.push(`${prefix}#${idx + 1}`);
  }

  const toFetch = neighbourIds.filter(id => !existingIds.has(id));
  const neighbours = toFetch.length > 0 ? await fetchChunksByIds(toFetch) : [];

  // Merge and sort by chunk index so the LLM receives text in document order.
  const all = [...hits, ...neighbours];
  all.sort((a, b) => {
    const idxA = parseInt(a.chunkId.split('#').pop() ?? '0', 10);
    const idxB = parseInt(b.chunkId.split('#').pop() ?? '0', 10);
    return idxA - idxB;
  });

  return all;
}

/**
 * Run a KNN vector search filtered to a single document.
 *
 * The bool/filter clause restricts candidates to chunks belonging to the
 * requested document before the KNN algorithm scores them, so users can only
 * retrieve context from documents they own.
 *
 * @param documentId - Restricts results to chunks from this document.
 * @param vector     - Query embedding (1024-dim from Titan).
 * @param size       - Number of top chunks to return (default 5).
 */
export async function searchRelevantChunks(documentId: string, vector: number[], size = 5): Promise<SearchHit[]> {
  const result = await client.search({
    index: config.vectorIndex,
    body: {
      size,
      query: {
        bool: {
          filter: [{ term: { documentId } }],
          must: [
            {
              knn: {
                vector: {
                  vector,
                  k: size
                }
              }
            }
          ]
        }
      }
    }
  });

  const hits = ((result as any).body?.hits?.hits || (result as any).hits?.hits || []) as Array<any>;
  return hits.map((hit) => ({
    chunkId:    hit._source.chunkId,
    documentId: hit._source.documentId,
    fileName:   hit._source.fileName,
    text:       hit._source.text,
    score:      hit._score
  }));
}
