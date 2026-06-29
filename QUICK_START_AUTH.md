# Quick Start: Authentication

## Get Your Credentials

After deploying, get your Cognito details:

```bash
aws cloudformation describe-stacks \
  --stack-name <your-stack-name> \
  --query 'Stacks[0].Outputs' \
  --output table
```

Save these values:
- `UserPoolId`
- `UserPoolClientId`
- `ApiBaseUrl`

## Create Your First User

```bash
# Set your values
USER_POOL_ID="<your-user-pool-id>"
EMAIL="your-email@example.com"
PASSWORD="YourSecure123!Pass"

# Create user
aws cognito-idp admin-create-user \
  --user-pool-id $USER_POOL_ID \
  --username $EMAIL \
  --user-attributes Name=email,Value=$EMAIL Name=email_verified,Value=true \
  --temporary-password TempPass123! \
  --message-action SUPPRESS

# Set permanent password
aws cognito-idp admin-set-user-password \
  --user-pool-id $USER_POOL_ID \
  --username $EMAIL \
  --password $PASSWORD \
  --permanent

echo "✅ User created: $EMAIL"
```

## Get Access Token

```bash
# Set your values
CLIENT_ID="<your-client-id>"
EMAIL="your-email@example.com"
PASSWORD="YourSecure123!Pass"

# Sign in
aws cognito-idp initiate-auth \
  --auth-flow USER_PASSWORD_AUTH \
  --client-id $CLIENT_ID \
  --auth-parameters USERNAME=$EMAIL,PASSWORD=$PASSWORD \
  --query 'AuthenticationResult.IdToken' \
  --output text

# Save the token
export ID_TOKEN="<paste-token-here>"
```

## Test Your API

```bash
# Set your values
API_BASE_URL="<your-api-base-url>"
ID_TOKEN="<your-id-token>"

# Get file size first
FILE_PATH="./your-document.pdf"
FILE_SIZE=$(stat -f%z "$FILE_PATH" 2>/dev/null || stat -c%s "$FILE_PATH" 2>/dev/null)

# Test 1: Generate pre-signed URL
# IMPORTANT: Must include fileSize parameter
curl -X GET \
  "$API_BASE_URL/generate-url?fileName=test.pdf&contentType=application/pdf&fileSize=$FILE_SIZE" \
  -H "Authorization: Bearer $ID_TOKEN"

# Should return: { "uploadUrl": "...", "fileKey": "...", "documentId": "...", "allowedTypes": [...] }

# Test 2: Upload file to S3
# (Use the uploadUrl from previous response)
curl -X PUT \
  "<upload-url-from-response>" \
  -H "Content-Type: application/pdf" \
  --upload-file "$FILE_PATH"

# Test 3: Register document
DOCUMENT_ID="<documentId-from-generate-url>"
FILE_KEY="<fileKey-from-generate-url>"

curl -X POST \
  "$API_BASE_URL/documents/register" \
  -H "Authorization: Bearer $ID_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"documentId\": \"$DOCUMENT_ID\",
    \"fileKey\": \"$FILE_KEY\",
    \"fileName\": \"test.pdf\",
    \"size\": $FILE_SIZE,
    \"type\": \"application/pdf\"
  }"

# Wait for ingestion to complete (check status in DynamoDB or logs)
# Status will change from REGISTERED → INGESTING → READY

# Test 4: Query document
curl -X POST \
  "$API_BASE_URL/query" \
  -H "Authorization: Bearer $ID_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"documentId\": \"$DOCUMENT_ID\",
    \"question\": \"What is this document about?\"
  }"
```

## Common Issues

### 401 Unauthorized
- Check token hasn't expired (60 min validity)
- Verify you're using the `IdToken` (not AccessToken)
- Ensure `Bearer` prefix in Authorization header

### "Document not found"
- Verify document was registered successfully
- Check you're querying with the correct documentId
- Ensure document belongs to the authenticated user

### "Document is not ready"
- Ingestion takes time (check CloudWatch logs)
- Check document status in DynamoDB table
- Verify S3 upload triggered the ingest Lambda

## Token Refresh

When your token expires:

```bash
REFRESH_TOKEN="<your-refresh-token>"
CLIENT_ID="<your-client-id>"

aws cognito-idp initiate-auth \
  --auth-flow REFRESH_TOKEN_AUTH \
  --client-id $CLIENT_ID \
  --auth-parameters REFRESH_TOKEN=$REFRESH_TOKEN \
  --query 'AuthenticationResult.IdToken' \
  --output text
```

## Environment Variables (Optional)

Add to your `.bashrc` or `.zshrc`:

```bash
export TALKTODOC_USER_POOL_ID="<your-user-pool-id>"
export TALKTODOC_CLIENT_ID="<your-client-id>"
export TALKTODOC_API_URL="<your-api-base-url>"
export TALKTODOC_EMAIL="your-email@example.com"
```

Then create an alias:

```bash
alias talktodoc-login='export TALKTODOC_TOKEN=$(aws cognito-idp initiate-auth \
  --auth-flow USER_PASSWORD_AUTH \
  --client-id $TALKTODOC_CLIENT_ID \
  --auth-parameters USERNAME=$TALKTODOC_EMAIL,PASSWORD=$TALKTODOC_PASSWORD \
  --query "AuthenticationResult.IdToken" \
  --output text) && echo "✅ Logged in"'
```
