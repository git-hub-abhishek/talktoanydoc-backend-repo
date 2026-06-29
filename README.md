# TalkToAnyDoc — Backend

Serverless AWS backend for document Q&A using retrieval-augmented generation (RAG). Upload a document, ask questions, get answers grounded in the document content.

**[Technical Architecture](https://git-hub-abhishek.github.io/talktoanydoc-backend-repo/infrastructure/architecture.html)**

---

## Features

- Direct S3 uploads via pre-signed URLs
- Document metadata and status tracking in DynamoDB
- S3-triggered ingestion pipeline (chunk → embed → index)
- Bedrock Titan embeddings (1024-dim)
- OpenSearch Serverless vector indexing with kNN search
- Two query modes:
  - **Standard streaming** — kNN top-k → Claude Sonnet streaming response
  - **Reranked streaming** — kNN k=20 → Claude Haiku reranking → top-5 → adjacent chunk expansion → Claude Sonnet streaming response
- Document delete — removes DynamoDB record and all OpenSearch chunks
- Bedrock Guardrails for content safety (denied topics, word filters)
- Runtime-configurable chunking and query settings via SSM Parameter Store
- Cognito JWT authentication on all endpoints

---

## Repository structure

```text
src/
  common/
    auth.ts           — Cognito user extraction from API Gateway context
    bedrock.ts        — Titan embeddings, Claude streaming, Haiku reranking
    chunker.ts        — Deterministic text chunking with configurable size/overlap
    config.ts         — Environment variable validation
    doc-parsers.ts    — Text extraction (UTF-8 / PDF / DOCX)
    dynamo.ts         — DynamoDB document CRUD
    http.ts           — API Gateway response helpers
    logger.ts         — Structured JSON logging
    opensearch.ts     — OpenSearch client (SigV4), vector upsert, kNN search, delete
    ssm.ts            — SSM Parameter Store config with cold-start caching
  handlers/
    generate-presigned-url.ts          — GET /generate-url
    register-document.ts               — POST /documents/register
    list-documents.ts                  — GET /documents
    ingest-document.ts                 — S3-triggered ingestion
    query-document.ts                  — POST /query (non-streaming)
    query-document-stream.ts           — Lambda URL streaming query
    query-document-stream-reranked.ts  — Lambda URL streaming query with reranking
    delete-document.ts                 — DELETE /documents/{documentId}
  types/
    document.ts
infrastructure/
  architecture.html   — Interactive architecture diagram
  opensearch-index.json
template.yaml         — AWS SAM template
```

---

## Prerequisites

- Node.js 20+
- AWS SAM CLI
- AWS account with Bedrock model access enabled:
  - `amazon.titan-embed-text-v2:0`
  - `anthropic.claude-sonnet-4-6` (or equivalent)
  - `anthropic.claude-haiku-4-5` (or equivalent)
- OpenSearch Serverless collection (VECTORSEARCH type)
- The OpenSearch index must be created before first deployment — use `infrastructure/opensearch-index.json` as the mapping

---

## Quick start

```bash
cp .env.example .env        # fill in your OpenSearch endpoint and other values
npm install
npm run build
sam build
sam deploy --guided         # first time — saves samconfig.toml
```

Subsequent deploys:

```bash
npm run build && sam build && sam deploy
```

---

## Runtime configuration (SSM)

Two SSM parameters are created by the SAM template. You can update them without redeploying Lambdas — changes take effect on the next Lambda cold start.

| Parameter | Default value |
|---|---|
| `/talktodoc/ingest-config` | `{"chunkSize":1000,"overlap":150}` |
| `/talktodoc/query-config` | `{"kNeighbours":5,"rerankedCandidates":20,"maxTokens":700}` |

Update via AWS Console or CLI:

```bash
aws ssm put-parameter \
  --name /talktodoc/query-config \
  --value '{"kNeighbours":7,"rerankedCandidates":25,"maxTokens":1000}' \
  --type String \
  --overwrite
```

---

## API reference

All endpoints require `Authorization: Bearer <id-token>` header.

### `GET /generate-url`

Query params: `fileName`, `contentType`, `fileSize`

```json
{
  "uploadUrl": "https://...",
  "fileKey": "uploads/<docId>/<fileName>",
  "documentId": "uuid"
}
```

### `POST /documents/register`

```json
{
  "fileKey": "uploads/<docId>/<fileName>",
  "fileName": "sample.pdf",
  "size": 123456,
  "type": "application/pdf"
}
```

Response: `{ "documentId": "uuid", "status": "REGISTERED" }`

### `GET /documents`

Returns array of documents owned by the authenticated user.

### `DELETE /documents/{documentId}`

Deletes OpenSearch chunks first, then the DynamoDB record. Returns `{ "documentId": "...", "deleted": true }`.

### `POST /query`

Non-streaming. Returns `{ "answer": "...", "sources": [...] }`.

### Lambda URL — streaming query

`POST <QUERY_STREAM_URL>` — standard streaming (kNN → Sonnet)

`POST <QUERY_STREAM_RERANKED_URL>` — reranked streaming (kNN → Haiku rerank → neighbour expand → Sonnet)

Request body: `{ "question": "...", "documentId": "uuid" }`

Response: `text/event-stream` with streamed answer text.

---

## Important notes

1. **OpenSearch index** must be created manually before ingestion using `infrastructure/opensearch-index.json`. The index requires `knn: true` and a `knn_vector` field with dimension 1024.
2. **Document parser** uses a UTF-8 fallback for non-text files. For scanned PDFs replace with Amazon Textract; for DOCX add `mammoth`.
3. **Guardrails** — the SAM template creates a Bedrock Guardrail resource. Editing policies in the console after deploy will be overwritten on the next `sam deploy`. Edit `template.yaml` instead.
4. **Delete ordering** — OpenSearch chunks are deleted before the DynamoDB record. If OpenSearch fails the record stays intact and the operation can be retried.
5. **Adjacent chunk expansion** is applied only in the reranked pipeline. The standard streaming handler uses plain kNN results.
