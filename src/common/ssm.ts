/**
 * SSM Parameter Store helpers with cold-start caching.
 *
 * Parameters are fetched once per Lambda container lifetime. Subsequent
 * calls within the same container return the cached value, avoiding a
 * network round-trip on every request. A redeploy or Lambda recycle will
 * pick up any parameter changes.
 *
 * Two parameter paths are used (injected as env vars by SAM):
 *   INGEST_CONFIG_PARAM  — chunking settings used by IngestDocumentFunction
 *   QUERY_CONFIG_PARAM   — retrieval + generation settings used by query handlers
 */

import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { config } from './config';
import { logger } from './logger';

const client = new SSMClient({ region: config.awsRegion });

export interface IngestConfig {
  /** Characters per chunk (default 1000). */
  chunkSize: number;
  /** Overlap carried from the previous chunk (default 150). */
  overlap: number;
}

export interface QueryConfig {
  /** k for the KNN search in the standard pipeline (default 5). */
  kNeighbours: number;
  /** k for the first-stage KNN retrieval in the reranked pipeline (default 20). */
  rerankedCandidates: number;
  /** max_tokens passed to Claude Sonnet for the final answer (default 700). */
  maxTokens: number;
}

// Module-level cache — one value per Lambda container cold-start.
let _ingestConfig: IngestConfig | null = null;
let _queryConfig: QueryConfig | null = null;

async function getParameter(name: string): Promise<string> {
  const result = await client.send(new GetParameterCommand({ Name: name }));
  const value = result.Parameter?.Value;
  if (!value) throw new Error(`SSM parameter not found or empty: ${name}`);
  return value;
}

/**
 * Return the ingest configuration from SSM, loading once per cold-start.
 * Falls back to hardcoded defaults if the parameter cannot be read so that
 * a misconfigured SSM path doesn't break ingestion entirely.
 */
export async function getIngestConfig(): Promise<IngestConfig> {
  if (_ingestConfig) return _ingestConfig;

  const defaults: IngestConfig = { chunkSize: 1000, overlap: 150 };

  try {
    const raw = await getParameter(config.ingestConfigParam);
    const parsed = JSON.parse(raw) as Partial<IngestConfig>;
    _ingestConfig = {
      chunkSize: parsed.chunkSize ?? defaults.chunkSize,
      overlap:   parsed.overlap   ?? defaults.overlap,
    };
    logger.info('Loaded ingest config from SSM', { config: _ingestConfig, param: config.ingestConfigParam });
  } catch (err) {
    logger.warn('Failed to load ingest config from SSM — using defaults', err);
    _ingestConfig = defaults;
  }

  return _ingestConfig;
}

/**
 * Return the query configuration from SSM, loading once per cold-start.
 * Falls back to hardcoded defaults so a bad parameter value never breaks
 * an in-flight query.
 */
export async function getQueryConfig(): Promise<QueryConfig> {
  if (_queryConfig) return _queryConfig;

  const defaults: QueryConfig = { kNeighbours: 5, rerankedCandidates: 20, maxTokens: 700 };

  try {
    const raw = await getParameter(config.queryConfigParam);
    const parsed = JSON.parse(raw) as Partial<QueryConfig>;
    _queryConfig = {
      kNeighbours:        parsed.kNeighbours        ?? defaults.kNeighbours,
      rerankedCandidates: parsed.rerankedCandidates  ?? defaults.rerankedCandidates,
      maxTokens:          parsed.maxTokens           ?? defaults.maxTokens,
    };
    logger.info('Loaded query config from SSM', { config: _queryConfig, param: config.queryConfigParam });
  } catch (err) {
    logger.warn('Failed to load query config from SSM — using defaults', err);
    _queryConfig = defaults;
  }

  return _queryConfig;
}
