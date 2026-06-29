# Cognito Authentication Implementation Summary

## Changes Made

### 1. Infrastructure Changes (template.yaml)

#### Added Resources:
- **UserPool**: Cognito User Pool with email-based authentication
  - Username attribute: email
  - Auto-verified: email
  - Password policy: 8+ chars, uppercase, lowercase, numbers, symbols
  - Account recovery via email

- **UserPoolClient**: Cognito User Pool Client
  - No client secret (for public clients)
  - Enabled auth flows: USER_SRP_AUTH, REFRESH_TOKEN_AUTH, USER_PASSWORD_AUTH
  - Token validity: Access/ID tokens (60 min), Refresh token (30 days)

#### Updated Globals:
- **Api.Auth**: Configured default Cognito authorizer for all API endpoints
- **Api.Cors**: Added CORS configuration with Authorization header support

#### Updated API Events:
All three API endpoints now require Cognito authentication:
- `GET /generate-url` (GeneratePresignedUrlFunction)
- `POST /documents/register` (RegisterDocumentFunction)
- `POST /query` (QueryDocumentFunction)

#### New Outputs:
- `UserPoolId`: For client configuration
- `UserPoolClientId`: For client authentication
- `UserPoolArn`: For reference

### 2. Code Changes

#### New Files:
- **src/common/auth.ts**: Authentication utilities
  - `CognitoUser` interface: Represents authenticated user
  - `getCognitoUser()`: Extracts user from API Gateway event
  - `requireAuth()`: Validates authentication, throws if missing

#### Updated Files:

**src/common/http.ts**:
- Added `unauthorized()` function for 401 responses

**src/types/document.ts**:
- Added `userId: string` field to `DocumentRecord` interface

**src/handlers/generate-presigned-url.ts**:
- Added authentication check using `requireAuth()`
- Added error handling for unauthorized access
- Logs userId for audit trail

**src/handlers/register-document.ts**:
- Added authentication check using `requireAuth()`
- Stores `userId` in document record
- Added error handling for unauthorized access
- Logs userId for audit trail

**src/handlers/query-document.ts**:
- Added authentication check using `requireAuth()`
- Validates document ownership (userId matches)
- Added error handling for unauthorized access
- Logs userId for audit trail

**src/handlers/ingest-document.ts**:
- No changes needed (S3-triggered, not API Gateway)
- userId already stored in document from register step

### 3. Documentation

#### New Files:
- **AUTHENTICATION.md**: Complete authentication guide
  - User registration and management
  - Token acquisition and refresh
  - API request examples
  - Frontend integration guides (Amplify, cognito-identity-js)
  - Access control explanation

#### Updated Files:
- **CLAUDE.md**: Added authentication section in architecture overview

## Security Features

1. **JWT Token Validation**: API Gateway validates tokens before Lambda invocation
2. **Document Scoping**: Documents are tied to users via userId
3. **Ownership Verification**: Query handler verifies document ownership
4. **Audit Trail**: All handlers log userId for operations
5. **Token Expiry**: Short-lived tokens (60 min) with refresh capability
6. **Strong Password Policy**: Enforced at user creation

## Deployment

To deploy these changes:

```bash
npm install
npm run build
sam build
sam deploy
```

After deployment:
1. Note the `UserPoolId` and `UserPoolClientId` from CloudFormation outputs
2. Create users using AWS CLI or Cognito console
3. Configure frontend with Cognito credentials
4. Include JWT token in all API requests

## Breaking Changes

⚠️ **All API endpoints now require authentication**

Existing clients must be updated to:
1. Authenticate with Cognito
2. Include `Authorization: Bearer <token>` header in all requests
3. Handle 401 Unauthorized responses
4. Implement token refresh logic

## Future Enhancements

Consider adding:
- User self-registration endpoint
- Email verification flow
- Password reset flow
- MFA support
- User profile management
- Document sharing between users
- Admin role for user management
