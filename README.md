# TalkToAnyDoc Backend Repository

This repository provides a production-oriented AWS backend starter for the TalkToAnyDoc use case:

- Direct S3 uploads using pre-signed URLs
- Document registration metadata in DynamoDB
- S3-triggered ingestion pipeline
- Deterministic text chunking
- Bedrock Titan embeddings
- OpenSearch vector indexing
- Query API backed by retrieval-augmented generation (RAG)
- AWS SAM template for deployment

## Repository structure

```text
src/
  common/
    config.ts
    http.ts
    logger.ts
    chunker.ts
    doc-parsers.ts
    opensearch.ts
    bedrock.ts
    dynamo.ts
  handlers/
    generate-presigned-url.ts
    register-document.ts
    ingest-document.ts
    query-document.ts
  types/
    document.ts
template.yaml
```

## Prerequisites

- Node.js 20+
- AWS SAM CLI
- Bedrock model access enabled in your AWS account
- S3 bucket for uploads
- DynamoDB table for document metadata
- OpenSearch domain or OpenSearch Serverless collection for vector search

## Quick start

```bash
cp .env.example .env
npm install
npm run build
sam build
sam deploy --guided
```

## API contract expected by the React UI

### `GET /generate-url?fileName=<name>&contentType=<mimeType>`
Returns:

```json
{
  "uploadUrl": "https://...",
  "fileKey": "uploads/<docId>/<fileName>",
  "documentId": "uuid"
}
```

### `POST /documents/register`
Request:

```json
{
  "fileKey": "uploads/<docId>/<fileName>",
  "fileName": "sample.pdf",
  "size": 123456,
  "type": "application/pdf"
}
```

Response:

```json
{
  "documentId": "uuid",
  "status": "REGISTERED"
}
```

### `POST /query`
Request:

```json
{
  "question": "What is the eligibility criteria?",
  "documentId": "uuid",
  "sessionId": "session-123"
}
```

Response:

```json
{
  "answer": "...",
  "sources": [
    {
      "chunkId": "uuid#0",
      "title": "sample.pdf"
    }
  ]
}
```

## Important implementation notes

1. The ingestion parser includes a safe text-first fallback. For scanned PDFs or complex documents, replace or extend the parser with Amazon Textract asynchronous processing.
2. OpenSearch vector indexing requires the target index to be created with a `knn_vector` field. A sample mapping is included under `infrastructure/opensearch-index.json`.
3. The repository intentionally keeps prompt construction and chunking deterministic.
4. This starter is designed to be extended with authentication, audit logging, observability, and Step Functions for high-volume ingestion.
