# API Documentation

## Overview

All endpoints require Cognito authentication via the `Authorization: Bearer <IdToken>` header.

## Base URL

```
https://<api-id>.execute-api.<region>.amazonaws.com/Prod
```

Replace with your actual API Gateway URL from CloudFormation outputs.

---

## Endpoints

### 1. Generate Pre-signed Upload URL

**Endpoint:** `GET /generate-url`

**Description:** Generates a pre-signed S3 URL for direct file upload. The URL enforces file type and size restrictions.

**Authentication:** Required

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| fileName | string | Yes | Name of the file to upload (must end with .pdf, .doc, or .docx) |
| contentType | string | Yes | MIME type of the file (must be one of the allowed types) |
| fileSize | number | Yes | Size of the file in bytes (max 100MB by default) |

**Allowed Content Types:**
- `application/pdf` - PDF files
- `application/msword` - DOC files
- `application/vnd.openxmlformats-officedocument.wordprocessingml.document` - DOCX files

**File Size Limit:** 100MB (104,857,600 bytes)

**Request Example:**

```bash
curl -X GET \
  "https://api-id.execute-api.us-east-1.amazonaws.com/Prod/generate-url?fileName=document.pdf&contentType=application/pdf&fileSize=2097152" \
  -H "Authorization: Bearer eyJraWQ..."
```

**Success Response (200 OK):**

```json
{
  "uploadUrl": "https://bucket.s3.amazonaws.com/uploads/uuid/document.pdf?X-Amz-Algorithm=...",
  "fileKey": "uploads/12345678-1234-1234-1234-123456789abc/document.pdf",
  "documentId": "12345678-1234-1234-1234-123456789abc",
  "expiresIn": 300,
  "maxSizeBytes": 104857600,
  "allowedTypes": [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ]
}
```

**Error Responses:**

| Status | Message | Reason |
|--------|---------|--------|
| 400 | fileName is required | Missing fileName parameter |
| 400 | contentType is required | Missing contentType parameter |
| 400 | fileSize is required | Missing fileSize parameter |
| 400 | Invalid file type. Only PDF and DOC/DOCX files are allowed | Unsupported content type |
| 400 | Invalid file extension. Only .pdf, .doc, .docx files are allowed | File name has wrong extension |
| 400 | File size exceeds maximum allowed size of 100MB | File too large |
| 401 | Unauthorized | Missing or invalid JWT token |
| 500 | Failed to generate upload URL | Server error |

---

### 2. Upload File to S3

**Endpoint:** Pre-signed URL from step 1

**Description:** Upload the actual file to S3 using the pre-signed URL.

**Authentication:** Not required (handled by pre-signed URL)

**Method:** PUT

**Headers:**
- `Content-Type`: Must match the contentType from step 1
- `Content-Length`: Must match the fileSize from step 1

**Request Example:**

```bash
curl -X PUT \
  "https://bucket.s3.amazonaws.com/uploads/uuid/document.pdf?X-Amz-Algorithm=..." \
  -H "Content-Type: application/pdf" \
  --upload-file ./document.pdf
```

**Success Response:** 200 OK (empty body)

**Note:** If you violate the restrictions (wrong content type or size), S3 will reject the upload with a 403 error.

---

### 3. Register Document

**Endpoint:** `POST /documents/register`

**Description:** Register document metadata in DynamoDB after successful S3 upload. This triggers the ingestion pipeline.

**Authentication:** Required

**Request Body:**

```json
{
  "documentId": "string (UUID from generate-url)",
  "fileKey": "string (from generate-url response)",
  "fileName": "string",
  "size": "number (bytes)",
  "type": "string (content type)"
}
```

**Request Example:**

```bash
curl -X POST \
  "https://api-id.execute-api.us-east-1.amazonaws.com/Prod/documents/register" \
  -H "Authorization: Bearer eyJraWQ..." \
  -H "Content-Type: application/json" \
  -d '{
    "documentId": "12345678-1234-1234-1234-123456789abc",
    "fileKey": "uploads/12345678-1234-1234-1234-123456789abc/document.pdf",
    "fileName": "document.pdf",
    "size": 2097152,
    "type": "application/pdf"
  }'
```

**Success Response (200 OK):**

```json
{
  "documentId": "12345678-1234-1234-1234-123456789abc",
  "status": "REGISTERED"
}
```

**Document Status Flow:**
1. `REGISTERED` - Document metadata saved, waiting for ingestion
2. `INGESTING` - Processing document (extracting text, generating embeddings)
3. `READY` - Document ready for queries
4. `FAILED` - Ingestion failed (check CloudWatch logs)

**Error Responses:**

| Status | Message | Reason |
|--------|---------|--------|
| 400 | Request body is required | Missing request body |
| 400 | fileKey, fileName, size and type are required | Missing required fields |
| 401 | Unauthorized | Missing or invalid JWT token |
| 500 | Failed to register document | Server error |

---

### 4. Query Document

**Endpoint:** `POST /query`

**Description:** Ask questions about a document using RAG (Retrieval-Augmented Generation).

**Authentication:** Required

**Access Control:** Users can only query documents they uploaded.

**Request Body:**

```json
{
  "documentId": "string (UUID)",
  "question": "string",
  "sessionId": "string (optional)"
}
```

**Request Example:**

```bash
curl -X POST \
  "https://api-id.execute-api.us-east-1.amazonaws.com/Prod/query" \
  -H "Authorization: Bearer eyJraWQ..." \
  -H "Content-Type: application/json" \
  -d '{
    "documentId": "12345678-1234-1234-1234-123456789abc",
    "question": "What is the main topic of this document?"
  }'
```

**Success Response (200 OK):**

```json
{
  "answer": "Based on the document, the main topic is...",
  "sources": [
    {
      "chunkId": "12345678-1234-1234-1234-123456789abc-chunk-0",
      "title": "document.pdf"
    },
    {
      "chunkId": "12345678-1234-1234-1234-123456789abc-chunk-5",
      "title": "document.pdf"
    }
  ]
}
```

**Error Responses:**

| Status | Message | Reason |
|--------|---------|--------|
| 400 | Request body is required | Missing request body |
| 400 | question and documentId are required | Missing required fields |
| 400 | Document not found | Document doesn't exist |
| 400 | Document is not ready. Current status: INGESTING | Document still processing |
| 401 | Unauthorized | Missing or invalid JWT token |
| 401 | You do not have access to this document | Document belongs to another user |
| 500 | Failed to answer question | Server error |

---

## Complete Upload Flow

### Step-by-Step Example

```bash
# 1. Authenticate and get token
ID_TOKEN=$(aws cognito-idp initiate-auth \
  --auth-flow USER_PASSWORD_AUTH \
  --client-id <ClientId> \
  --auth-parameters USERNAME=user@example.com,PASSWORD=Password123! \
  --query 'AuthenticationResult.IdToken' \
  --output text)

# 2. Get file size
FILE_PATH="./my-document.pdf"
FILE_SIZE=$(stat -f%z "$FILE_PATH")  # macOS
# FILE_SIZE=$(stat -c%s "$FILE_PATH")  # Linux

# 3. Generate pre-signed URL
RESPONSE=$(curl -s -X GET \
  "https://api-id.execute-api.us-east-1.amazonaws.com/Prod/generate-url?fileName=my-document.pdf&contentType=application/pdf&fileSize=$FILE_SIZE" \
  -H "Authorization: Bearer $ID_TOKEN")

UPLOAD_URL=$(echo $RESPONSE | jq -r '.uploadUrl')
FILE_KEY=$(echo $RESPONSE | jq -r '.fileKey')
DOCUMENT_ID=$(echo $RESPONSE | jq -r '.documentId')

echo "Document ID: $DOCUMENT_ID"

# 4. Upload file to S3
curl -X PUT \
  "$UPLOAD_URL" \
  -H "Content-Type: application/pdf" \
  --upload-file "$FILE_PATH"

# 5. Register document
curl -X POST \
  "https://api-id.execute-api.us-east-1.amazonaws.com/Prod/documents/register" \
  -H "Authorization: Bearer $ID_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"documentId\": \"$DOCUMENT_ID\",
    \"fileKey\": \"$FILE_KEY\",
    \"fileName\": \"my-document.pdf\",
    \"size\": $FILE_SIZE,
    \"type\": \"application/pdf\"
  }"

# 6. Wait for ingestion (poll status or check CloudWatch logs)
sleep 30

# 7. Query the document
curl -X POST \
  "https://api-id.execute-api.us-east-1.amazonaws.com/Prod/query" \
  -H "Authorization: Bearer $ID_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"documentId\": \"$DOCUMENT_ID\",
    \"question\": \"Summarize this document in 3 sentences\"
  }"
```

---

## Frontend Integration Examples

### JavaScript/TypeScript with Fetch

```typescript
interface UploadOptions {
  file: File;
  idToken: string;
  apiBaseUrl: string;
}

async function uploadDocument({ file, idToken, apiBaseUrl }: UploadOptions) {
  // Validate file type
  const allowedTypes = ['application/pdf', 'application/msword', 
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
  
  if (!allowedTypes.includes(file.type)) {
    throw new Error('Only PDF and DOC/DOCX files are allowed');
  }

  // Validate file size (100MB)
  const maxSize = 100 * 1024 * 1024;
  if (file.size > maxSize) {
    throw new Error('File size exceeds 100MB limit');
  }

  // Step 1: Get pre-signed URL
  const presignedResponse = await fetch(
    `${apiBaseUrl}/generate-url?fileName=${encodeURIComponent(file.name)}&contentType=${file.type}&fileSize=${file.size}`,
    {
      headers: {
        'Authorization': `Bearer ${idToken}`
      }
    }
  );

  if (!presignedResponse.ok) {
    const error = await presignedResponse.json();
    throw new Error(error.message);
  }

  const { uploadUrl, fileKey, documentId } = await presignedResponse.json();

  // Step 2: Upload to S3
  const uploadResponse = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': file.type
    },
    body: file
  });

  if (!uploadResponse.ok) {
    throw new Error('Failed to upload file to S3');
  }

  // Step 3: Register document
  const registerResponse = await fetch(`${apiBaseUrl}/documents/register`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${idToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      documentId,
      fileKey,
      fileName: file.name,
      size: file.size,
      type: file.type
    })
  });

  if (!registerResponse.ok) {
    const error = await registerResponse.json();
    throw new Error(error.message);
  }

  return { documentId, status: 'REGISTERED' };
}

async function queryDocument(documentId: string, question: string, idToken: string, apiBaseUrl: string) {
  const response = await fetch(`${apiBaseUrl}/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${idToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      documentId,
      question
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message);
  }

  return await response.json();
}
```

### React Hook Example

```typescript
import { useState } from 'react';

export function useDocumentUpload(idToken: string, apiBaseUrl: string) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  const upload = async (file: File) => {
    setUploading(true);
    setError(null);
    setProgress(0);

    try {
      setProgress(10);
      
      // Get pre-signed URL
      const presignedResponse = await fetch(
        `${apiBaseUrl}/generate-url?fileName=${encodeURIComponent(file.name)}&contentType=${file.type}&fileSize=${file.size}`,
        {
          headers: { 'Authorization': `Bearer ${idToken}` }
        }
      );
      
      if (!presignedResponse.ok) {
        const err = await presignedResponse.json();
        throw new Error(err.message);
      }

      const { uploadUrl, fileKey, documentId } = await presignedResponse.json();
      setProgress(30);

      // Upload to S3
      const uploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file
      });

      if (!uploadResponse.ok) {
        throw new Error('Upload to S3 failed');
      }
      setProgress(70);

      // Register document
      const registerResponse = await fetch(`${apiBaseUrl}/documents/register`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${idToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          documentId,
          fileKey,
          fileName: file.name,
          size: file.size,
          type: file.type
        })
      });

      if (!registerResponse.ok) {
        const err = await registerResponse.json();
        throw new Error(err.message);
      }

      setProgress(100);
      return { documentId, status: 'REGISTERED' };
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
      throw err;
    } finally {
      setUploading(false);
    }
  };

  return { upload, uploading, error, progress };
}
```

---

## Error Handling Best Practices

1. **Always validate file type and size on the frontend** before calling the API
2. **Handle token expiration** - Refresh tokens when they expire (60 min validity)
3. **Implement retry logic** for network failures
4. **Show progress indicators** during upload and ingestion
5. **Poll document status** after registration to know when it's ready for queries
6. **Handle 401 errors** by redirecting to login

---

## Rate Limits

Currently no rate limits are enforced at the API Gateway level. Consider implementing:
- Cognito Adaptive Authentication for suspicious activity
- API Gateway usage plans for production
- CloudWatch alarms for unusual traffic patterns
