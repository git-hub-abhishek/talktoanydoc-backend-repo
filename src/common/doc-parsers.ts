/**
 * Document text extraction for the ingestion pipeline.
 *
 * Supported formats:
 *   .pdf  — pdf-parse v1 (Node.js compatible; v2 requires DOM globals unavailable in Lambda)
 *   .docx — mammoth (extracts raw text, ignoring formatting)
 *   .txt  — direct UTF-8 read
 *
 * Unsupported formats fall back to a UTF-8 read with a warning. This produces
 * garbled output for binary files (e.g. scanned PDFs, legacy .doc) — replace
 * with Amazon Textract for production use cases that require those formats.
 */

import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import { logger } from './logger';

/**
 * Extract plain text from a document buffer.
 *
 * @param fileName - Original file name, used only to determine the parser by extension.
 * @param buffer   - Raw file bytes downloaded from S3.
 * @returns        Extracted plain text string.
 */
export async function extractTextFromBuffer(fileName: string, buffer: Buffer): Promise<string> {
  const lowerName = fileName.toLowerCase();

  if (lowerName.endsWith('.txt')) {
    return buffer.toString('utf-8');
  }

  if (lowerName.endsWith('.pdf')) {
    const data = await pdfParse(buffer);
    logger.info('Extracted PDF text', { fileName, pages: data.numpages, chars: data.text.length });
    return data.text;
  }

  if (lowerName.endsWith('.docx')) {
    const result = await mammoth.extractRawText({ buffer });
    logger.info('Extracted DOCX text', { fileName, chars: result.value.length });
    return result.value;
  }

  // .doc and other binary formats — UTF-8 decode will produce mostly garbage.
  // Log a warning so the issue is visible in CloudWatch.
  logger.warn('Unsupported file type, falling back to UTF-8 extraction', { fileName });
  return buffer.toString('utf-8');
}
