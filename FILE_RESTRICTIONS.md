# File Upload Restrictions

## Overview

The TalkToAnyDoc API enforces strict file type and size restrictions to ensure security and optimal processing. Only PDF and Microsoft Word documents are accepted.

## Restrictions

### File Types

**Allowed Extensions:**
- `.pdf` - Portable Document Format
- `.doc` - Microsoft Word 97-2003
- `.docx` - Microsoft Word 2007+

**Allowed MIME Types:**
- `application/pdf`
- `application/msword`
- `application/vnd.openxmlformats-officedocument.wordprocessingml.document`

### File Size

- **Maximum size**: 100MB (104,857,600 bytes)
- **Configurable**: Set via `MAX_UPLOAD_SIZE_MB` environment variable in `template.yaml`

## Validation Layers

### 1. Frontend Validation (Recommended)

Validate on the client side before making API calls:

```javascript
function validateFile(file) {
  const allowedTypes = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ];
  
  const allowedExtensions = ['.pdf', '.doc', '.docx'];
  const maxSize = 100 * 1024 * 1024; // 100MB
  
  // Check file type
  if (!allowedTypes.includes(file.type)) {
    throw new Error('Only PDF and DOC/DOCX files are allowed');
  }
  
  // Check file extension
  const extension = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
  if (!allowedExtensions.includes(extension)) {
    throw new Error(`Invalid file extension: ${extension}`);
  }
  
  // Check file size
  if (file.size > maxSize) {
    throw new Error(`File size exceeds 100MB limit (${(file.size / 1024 / 1024).toFixed(2)}MB)`);
  }
  
  return true;
}
```

### 2. API Gateway Validation

The `/generate-url` endpoint validates:
- `fileName` parameter exists and has valid extension
- `contentType` parameter is one of the allowed MIME types
- `fileSize` parameter is provided and within limits

**Error Responses:**

```json
// Invalid file type
{
  "message": "Invalid file type. Only PDF and DOC/DOCX files are allowed. Received: image/jpeg"
}

// Invalid extension
{
  "message": "Invalid file extension. Only .pdf, .doc, .docx files are allowed. Received: .jpg"
}

// File too large
{
  "message": "File size exceeds maximum allowed size of 100MB. Received: 150.25MB"
}
```

### 3. S3 Pre-signed URL Conditions

The pre-signed URL includes conditions that S3 enforces:
- `Content-Type` must match the specified MIME type
- `Content-Length` must match the specified file size

If the client attempts to upload a file with different type or size, S3 returns **403 Forbidden**.

## Implementation Details

### Handler: `src/handlers/generate-presigned-url.ts`

```typescript
// Constants defined at module level
const ALLOWED_CONTENT_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
];

const ALLOWED_EXTENSIONS = ['.pdf', '.doc', '.docx'];

// Validation logic
1. Check fileName, contentType, fileSize are all provided
2. Validate contentType is in ALLOWED_CONTENT_TYPES
3. Validate file extension is in ALLOWED_EXTENSIONS
4. Validate fileSize is positive and within maxUploadSizeMb limit
5. Generate pre-signed URL with Content-Type and Content-Length constraints
```

### S3 PutObject Command

```typescript
const command = new PutObjectCommand({
  Bucket: config.uploadBucket,
  Key: fileKey,
  ContentType: contentType,      // Enforced by S3
  ContentLength: fileSizeBytes,  // Enforced by S3
  Metadata: {
    'original-filename': fileName,
    'user-id': user.userId,
    'upload-timestamp': new Date().toISOString()
  }
});
```

## API Usage

### Correct Usage

```bash
# Get file size
FILE_SIZE=$(stat -f%z "document.pdf")  # macOS
# FILE_SIZE=$(stat -c%s "document.pdf")  # Linux

# Request pre-signed URL with all required parameters
curl -X GET \
  "https://api.example.com/generate-url?fileName=document.pdf&contentType=application/pdf&fileSize=$FILE_SIZE" \
  -H "Authorization: Bearer <token>"
```

### Common Mistakes

❌ **Missing fileSize parameter**
```bash
# This will fail with 400 Bad Request
curl "https://api.example.com/generate-url?fileName=doc.pdf&contentType=application/pdf"
```

❌ **Wrong content type**
```bash
# This will fail with 400 Bad Request
curl "https://api.example.com/generate-url?fileName=doc.pdf&contentType=text/plain&fileSize=1000"
```

❌ **Mismatched extension and MIME type**
```bash
# This will fail - extension is .jpg but claiming PDF
curl "https://api.example.com/generate-url?fileName=doc.jpg&contentType=application/pdf&fileSize=1000"
```

❌ **File too large**
```bash
# This will fail with 400 Bad Request
FILE_SIZE=209715200  # 200MB
curl "https://api.example.com/generate-url?fileName=huge.pdf&contentType=application/pdf&fileSize=$FILE_SIZE"
```

## Security Considerations

### Why These Restrictions?

1. **Document Processing**: The backend uses document-specific parsers for text extraction
2. **Resource Management**: Large files consume significant Lambda memory and execution time
3. **Security**: Limiting file types reduces attack surface (no executables, scripts, etc.)
4. **Predictable Costs**: File size limits help control AWS costs

### Additional Security Measures

While not currently implemented, consider adding:
- **Virus scanning**: AWS CloudFormation StackSets with ClamAV
- **Content verification**: Verify uploaded file actually matches declared MIME type
- **Rate limiting**: Prevent abuse via API Gateway usage plans
- **IP allowlisting**: Restrict API access to known IP ranges

## Troubleshooting

### "File size exceeds maximum allowed size"

**Solution**: Compress the PDF or split the document into smaller files. For legitimate large documents, increase `MAX_UPLOAD_SIZE_MB` in `template.yaml` and redeploy.

### "Invalid file type" but file is a valid PDF

**Cause**: Browser/client may be sending wrong MIME type.

**Solution**: Explicitly set content type:
```javascript
const contentType = 'application/pdf';  // Don't rely on file.type
```

### Upload to S3 returns 403 Forbidden

**Causes**:
1. Content-Type header doesn't match pre-signed URL
2. File size doesn't match Content-Length in pre-signed URL
3. Pre-signed URL expired (default 5 minutes)

**Solution**: Ensure exact match of content type and size, generate fresh URL if expired.

### DOCX files fail ingestion

**Known Issue**: The current document parser (`src/common/doc-parsers.ts`) uses UTF-8 fallback which doesn't properly extract text from DOCX files.

**Workaround**: Convert DOCX to PDF before upload, or implement proper DOCX parsing (see [CLAUDE.md](CLAUDE.md) for details).

## Future Enhancements

Potential improvements:
- Support for additional formats (TXT, RTX, Markdown)
- Chunked/resumable uploads for very large files
- Client-side compression before upload
- Automatic format conversion (e.g., DOCX → PDF)
- File preview/thumbnail generation
- Duplicate detection (hash-based)

## Configuration

### Change Maximum File Size

Edit `template.yaml`:

```yaml
Globals:
  Function:
    Environment:
      Variables:
        MAX_UPLOAD_SIZE_MB: '200'  # Change from 100 to 200
```

Then redeploy:
```bash
sam build && sam deploy
```

### Add New File Types

1. Update constants in `src/handlers/generate-presigned-url.ts`:
```typescript
const ALLOWED_CONTENT_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain'  // Add TXT support
];

const ALLOWED_EXTENSIONS = ['.pdf', '.doc', '.docx', '.txt'];
```

2. Update document parser in `src/common/doc-parsers.ts` to handle the new format

3. Rebuild and redeploy

4. Update documentation
