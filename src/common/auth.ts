/**
 * Cognito authentication helpers for API Gateway Lambda proxy integrations.
 *
 * API Gateway validates the JWT via the Cognito Authorizer before the Lambda is
 * invoked. On success it injects the token claims into
 * event.requestContext.authorizer.claims, so no JWT verification is needed here —
 * the framework has already done it.
 *
 * The stream handler (query-document-stream.ts) bypasses API Gateway and uses a
 * Lambda Function URL, so it performs its own JWT verification with aws-jwt-verify.
 */

import { APIGatewayProxyEvent } from 'aws-lambda';

export interface CognitoUser {
  /** Cognito sub — stable unique identifier for the user, used as the ownership key. */
  userId: string;
  email?: string;
  username: string;
}

/** Extract the Cognito user from the API Gateway authorizer claims context. */
export function getCognitoUser(event: APIGatewayProxyEvent): CognitoUser | null {
  const claims = event.requestContext.authorizer?.claims;
  if (!claims) return null;

  return {
    userId: claims.sub,
    email: claims.email,
    username: claims['cognito:username'] || claims.email
  };
}

/**
 * Extract the Cognito user or throw an Unauthorized error.
 * Used at the top of every API Gateway handler to enforce authentication.
 */
export function requireAuth(event: APIGatewayProxyEvent): CognitoUser {
  const user = getCognitoUser(event);
  if (!user) {
    throw new Error('Unauthorized: No valid Cognito user found');
  }
  return user;
}
