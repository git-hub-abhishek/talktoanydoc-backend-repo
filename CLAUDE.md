# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

TalkToAnyDoc is a serverless AWS backend for document Q&A using retrieval-augmented generation (RAG). The system:

1. Generates pre-signed S3 URLs for direct document uploads
2. Registers document metadata in DynamoDB
3. Processes uploaded documents via S3-triggered Lambda ingestion
4. Chunks text deterministically and generates embeddings using Bedrock Titan
5. Indexes embeddings in OpenSearch for vector similarity search
6. Answers queries using Claude 3.5 Sonnet on Bedrock with retrieved context

## Build and deployment commands

```bash
# Install dependencies
npm install

# Compile TypeScript to dist/
npm run build

# Clean build artifacts
npm run clean

# Build SAM application (runs after npm run build)
sam build

# Deploy with guided prompts (first time)
sam deploy --guided

# Deploy after initial setup
sam deploy

# Test locally (requires Docker)
sam local start-api
```

## Architecture

### Authentication

All API endpoints are protected with AWS Cognito User Pool authentication:

- Users must authenticate via Cognito to receive JWT tokens
- JWT tokens are passed in the `Authorization: Bearer <token>` header
- API Gateway validates tokens before invoking Lambda functions
- Lambda functions extract user identity from the authorizer context via `src/common/auth.ts`
- Documents are scoped to users - each document stores the `userId` of the uploader
- Query operations verify document ownership before returning results

See [AUTHENTICATION.md](AUTHENTICATION.md) for detailed authentication setup and usage instructions.

### File Upload Restrictions

The pre-signed URL generation enforces strict file type and size restrictions:

- **Allowed file types**: PDF (.pdf), DOC (.doc), DOCX (.docx)
- **Allowed MIME types**: 
  - `application/pdf`
  - `application/msword`
  - `application/vnd.openxmlformats-officedocument.wordprocessingml.document`
- **Maximum file size**: 100MB (configurable via `MAX_UPLOAD_SIZE_MB`)
- **Required parameters**: `fileName`, `contentType`, and `fileSize` must be provided to `/generate-url`
- **Validation**: Both MIME type and file extension are validated before generating pre-signed URL
- **S3 enforcement**: Pre-signed URLs include Content-Type and Content-Length conditions

The restrictions are enforced at both the API level (parameter validation) and S3 level (pre-signed URL conditions).

### Data flow

**Upload → Register → Ingest → Query**

1. Frontend authenticates user and obtains JWT token from Cognito
2. Frontend requests pre-signed URL (`generate-presigned-url.ts`) with Authorization header
3. Frontend uploads directly to S3 under `uploads/{documentId}/{fileName}`
4. Frontend registers document metadata (`register-document.ts`) with status `REGISTERED` and `userId`
4. S3 ObjectCreated event triggers `ingest-document.ts`:
   - Downloads file from S3
   - Extracts text (currently fallback UTF-8, production should use Textract for PDFs)
   - Chunks text with overlap (default 1000 chars, 150 char overlap)
   - Generates embeddings for each chunk via Bedrock Titan
   - Upserts chunks to OpenSearch with vectors
   - Updates document status to `READY` or `FAILED`
5. Query handler (`query-document.ts`):
   - Embeds user question
   - Performs knn vector search filtered by documentId
   - Retrieves top 5 chunks
   - Constructs prompt with context and invokes Claude via Bedrock
   - Returns answer with source citations

### Key modules

- **src/common/auth.ts**: Cognito user extraction from API Gateway authorizer context
- **src/common/config.ts**: Environment variable validation and centralized configuration
- **src/common/chunker.ts**: Deterministic text chunking with configurable size/overlap
- **src/common/bedrock.ts**: Bedrock API calls for embeddings (Titan) and chat completion (Claude)
- **src/common/opensearch.ts**: OpenSearch client with AWS Sigv4, vector upsert and knn search
- **src/common/doc-parsers.ts**: Text extraction (currently UTF-8 fallback only)
- **src/common/dynamo.ts**: DynamoDB operations for document metadata and status tracking
- **src/common/http.ts**: API Gateway response helpers (includes `unauthorized()` for 401 responses)
- **src/common/logger.ts**: Structured logging

### OpenSearch index requirements

The vector index must be created manually before ingestion. Use `infrastructure/opensearch-index.json` as the mapping template:

- `vector` field: `knn_vector` type with dimension 1024 (Titan v2 embedding size)
- Method: HNSW algorithm with cosine similarity
- Index must have `knn: true` setting enabled

Create via OpenSearch API or AWS console before first deployment.

### Document parser limitations

**Important**: `src/common/doc-parsers.ts` currently uses a UTF-8 fallback for all non-.txt files. This produces poor results for:

- Binary PDFs (especially scanned documents)
- DOCX files
- Any formatted documents

For production:
- Replace with Amazon Textract for scanned PDFs (requires async processing with SNS/SQS)
- Add `mammoth` or similar for DOCX parsing
- Add `pdf-parse` for native PDF text extraction

The fallback logs a warning on every non-.txt file processed.

### Prompt construction

The RAG prompt in `src/common/bedrock.ts` (`answerQuestion`) is intentionally simple and deterministic:
- Instructs model to answer strictly from context
- Concatenates top-5 chunks with separator
- Returns "Not found in document" if no answer present

When modifying prompts, maintain deterministic behavior and avoid hallucinations.

### Environment configuration

Required environment variables (set in `template.yaml` Globals or override in `.env` for local testing):

- `OPENSEARCH_ENDPOINT`: Must be updated from placeholder `https://replace-me.example.com`
- `UPLOAD_BUCKET`, `DOCUMENT_TABLE`, `VECTOR_INDEX`: Auto-created by CloudFormation
- `BEDROCK_EMBED_MODEL_ID`: `amazon.titan-embed-text-v2:0` (1024-dim embeddings)
- `BEDROCK_CHAT_MODEL_ID`: `anthropic.claude-3-5-sonnet-20241022-v2:0`

Bedrock model access must be enabled in your AWS account before deployment.

### Lambda timeout and memory

- Standard functions: 60s timeout, 1024MB memory
- `IngestDocumentFunction`: 300s timeout, 2048MB memory (handles large documents)

Adjust in `template.yaml` if processing very large files or batches.

### Testing considerations

This is a starter repository without test infrastructure. When adding tests:
- Mock AWS SDK clients (`@aws-sdk/client-*`)
- Mock Bedrock API responses with realistic embedding dimensions
- Test chunking edge cases (empty docs, single-char docs, boundary conditions)
- Verify OpenSearch knn query structure matches mapping schema

The ingestion pipeline is idempotent (upsert by chunkId), so reprocessing the same document is safe.
