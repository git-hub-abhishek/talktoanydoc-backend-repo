/**
 * Shared type definitions for document records and search results.
 */

/**
 * A document record stored in DynamoDB.
 *
 * Status lifecycle:
 *   UPLOADING   — frontend is uploading to S3 (pre-register state, set by the frontend)
 *   REGISTERED  — metadata saved to DynamoDB, waiting for S3 trigger
 *   INGESTING   — IngestDocumentFunction is processing the file
 *   READY       — all chunks embedded and indexed in OpenSearch; document is queryable
 *   FAILED      — ingestion threw an error; document cannot be queried
 */
export interface DocumentRecord {
  /** UUID generated at pre-signed URL creation time. Primary key. */
  documentId: string;
  /** S3 object key: "uploads/{documentId}/{sanitisedFileName}" */
  fileKey: string;
  /** Original file name as provided by the user. */
  fileName: string;
  /** File size in bytes. */
  size: number;
  /** MIME type (e.g. "application/pdf"). */
  type: string;
  status: 'UPLOADING' | 'REGISTERED' | 'INGESTING' | 'READY' | 'FAILED';
  /** ISO 8601 timestamp set when the document was first registered. */
  uploadedAt: string;
  /** ISO 8601 timestamp updated on every status change. */
  updatedAt: string;
  /** Cognito sub of the uploading user — used to enforce ownership on queries. */
  userId: string;
}

/** A single KNN search hit returned from OpenSearch. */
export interface SearchHit {
  /** Chunk identifier: "{documentId}#{index}" */
  chunkId: string;
  documentId: string;
  fileName: string;
  /** Raw text of the chunk — passed to the LLM as context. */
  text: string;
  /** Cosine similarity score from OpenSearch (higher = more relevant). */
  score?: number;
}
