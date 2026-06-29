# Authentication Guide

All API endpoints are protected with AWS Cognito User Pool authentication. Users must authenticate and include a valid JWT token in the `Authorization` header of all requests.

## Setup

After deploying with `sam deploy`, the CloudFormation outputs will include:

- `UserPoolId`: The Cognito User Pool ID
- `UserPoolClientId`: The Cognito User Pool Client ID
- `ApiBaseUrl`: The API Gateway base URL

## User Registration and Sign-in

### 1. Create a new user (Admin)

Using AWS CLI:

```bash
aws cognito-idp admin-create-user \
  --user-pool-id <UserPoolId> \
  --username user@example.com \
  --user-attributes Name=email,Value=user@example.com Name=email_verified,Value=true \
  --temporary-password TempPassword123! \
  --message-action SUPPRESS
```

### 2. Set permanent password (Admin)

```bash
aws cognito-idp admin-set-user-password \
  --user-pool-id <UserPoolId> \
  --username user@example.com \
  --password YourSecurePassword123! \
  --permanent
```

### 3. Sign in to get tokens

Using AWS CLI:

```bash
aws cognito-idp initiate-auth \
  --auth-flow USER_PASSWORD_AUTH \
  --client-id <UserPoolClientId> \
  --auth-parameters USERNAME=user@example.com,PASSWORD=YourSecurePassword123!
```

Response includes:
- `IdToken`: Use this for API authentication
- `AccessToken`: Access token
- `RefreshToken`: Use to refresh expired tokens

### 4. Refresh tokens when expired

```bash
aws cognito-idp initiate-auth \
  --auth-flow REFRESH_TOKEN_AUTH \
  --client-id <UserPoolClientId> \
  --auth-parameters REFRESH_TOKEN=<your-refresh-token>
```

## Making Authenticated API Requests

Include the `IdToken` in the `Authorization` header:

### File Upload Restrictions

The system enforces the following restrictions:
- **Allowed file types**: PDF (.pdf), DOC (.doc), DOCX (.docx)
- **Maximum file size**: 100MB (configurable via `MAX_UPLOAD_SIZE_MB` environment variable)
- **Required parameters**: `fileName`, `contentType`, and `fileSize` must be provided

```bash
# Generate pre-signed URL
# IMPORTANT: Must include fileName, contentType, AND fileSize parameters
curl -X GET \
  "https://<api-id>.execute-api.<region>.amazonaws.com/Prod/generate-url?fileName=test.pdf&contentType=application/pdf&fileSize=1048576" \
  -H "Authorization: Bearer <IdToken>"

# Register document
curl -X POST \
  "https://<api-id>.execute-api.<region>.amazonaws.com/Prod/documents/register" \
  -H "Authorization: Bearer <IdToken>" \
  -H "Content-Type: application/json" \
  -d '{
    "fileKey": "uploads/doc-id/test.pdf",
    "fileName": "test.pdf",
    "size": 12345,
    "type": "application/pdf",
    "documentId": "doc-id"
  }'

# Query document
curl -X POST \
  "https://<api-id>.execute-api.<region>.amazonaws.com/Prod/query" \
  -H "Authorization: Bearer <IdToken>" \
  -H "Content-Type: application/json" \
  -d '{
    "documentId": "doc-id",
    "question": "What is this document about?"
  }'
```

## Frontend Integration

### Using AWS Amplify (Recommended)

```javascript
import { Amplify, Auth } from 'aws-amplify';

Amplify.configure({
  Auth: {
    region: '<aws-region>',
    userPoolId: '<UserPoolId>',
    userPoolWebClientId: '<UserPoolClientId>',
  }
});

// Sign in
const user = await Auth.signIn(username, password);
const idToken = user.signInUserSession.idToken.jwtToken;

// Make authenticated requests
const response = await fetch(`${API_BASE_URL}/generate-url?fileName=test.pdf`, {
  headers: {
    'Authorization': `Bearer ${idToken}`
  }
});
```

### Using amazon-cognito-identity-js

```javascript
import { CognitoUserPool, CognitoUser, AuthenticationDetails } from 'amazon-cognito-identity-js';

const poolData = {
  UserPoolId: '<UserPoolId>',
  ClientId: '<UserPoolClientId>'
};

const userPool = new CognitoUserPool(poolData);

// Sign in
const authenticationDetails = new AuthenticationDetails({
  Username: username,
  Password: password,
});

const cognitoUser = new CognitoUser({
  Username: username,
  Pool: userPool,
});

cognitoUser.authenticateUser(authenticationDetails, {
  onSuccess: (result) => {
    const idToken = result.getIdToken().getJwtToken();
    // Use idToken in Authorization header
  },
  onFailure: (err) => {
    console.error(err);
  },
});
```

## Document Access Control

Documents are scoped to users:
- Users can only query documents they uploaded
- The `userId` from the Cognito token is stored with each document
- Query requests validate document ownership before processing

## Token Validity

- **Access Token**: 60 minutes
- **ID Token**: 60 minutes
- **Refresh Token**: 30 days

## Password Policy

- Minimum length: 8 characters
- Requires uppercase letters
- Requires lowercase letters
- Requires numbers
- Requires symbols

## CORS Configuration

The API Gateway is configured with CORS to allow:
- Methods: GET, POST, OPTIONS
- Headers: Content-Type, Authorization
- Origin: * (configure this to your frontend domain in production)
