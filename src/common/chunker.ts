/**
 * Deterministic text chunker for the ingestion pipeline.
 *
 * Splits extracted document text into overlapping fixed-size chunks so that
 * each chunk fits within the Bedrock Titan embedding model's token limit while
 * preserving context across chunk boundaries via the overlap window.
 *
 * Chunk IDs are deterministic: "{documentId}#{index}" so the same document can
 * be re-ingested safely — OpenSearch upserts will overwrite existing chunks
 * rather than creating duplicates.
 */

export interface ChunkResult {
  /** Deterministic ID: "{documentId}#{index}" — used as the OpenSearch document _id. */
  chunkId: string;
  /** The raw text slice for this chunk. */
  text: string;
}

/**
 * Split text into overlapping chunks.
 *
 * @param documentId - Used to build deterministic chunkIds.
 * @param text       - Full extracted document text.
 * @param chunkSize  - Maximum characters per chunk (default 1000).
 * @param overlap    - Characters carried over from the previous chunk to preserve
 *                     context at boundaries (default 150).
 */
export function chunkText(documentId: string, text: string, chunkSize = 1000, overlap = 150): ChunkResult[] {
  // Collapse all whitespace to single spaces so chunk boundaries don't fall in
  // the middle of multi-line whitespace sequences.
  const normalised = text.replace(/\s+/g, ' ').trim();
  if (!normalised) return [];

  const chunks: ChunkResult[] = [];
  let index = 0;
  let cursor = 0;

  while (cursor < normalised.length) {
    const end = Math.min(cursor + chunkSize, normalised.length);
    const slice = normalised.slice(cursor, end).trim();
    if (slice) {
      chunks.push({ chunkId: `${documentId}#${index}`, text: slice });
      index += 1;
    }
    if (end === normalised.length) break;
    // Advance by (chunkSize - overlap) but never go backwards if overlap >= chunkSize.
    cursor = Math.max(end - overlap, cursor + 1);
  }

  return chunks;
}
