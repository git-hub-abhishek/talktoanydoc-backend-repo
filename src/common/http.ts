/**
 * API Gateway response helpers.
 *
 * All responses include CORS headers so the React frontend (served from
 * CloudFront) can call the API from a different origin.
 */

import { APIGatewayProxyResult } from 'aws-lambda';

/** 200 OK with a JSON body. */
export function ok(body: unknown): APIGatewayProxyResult {
  return response(200, body);
}

/** 400 Bad Request — invalid input from the caller. */
export function badRequest(message: string): APIGatewayProxyResult {
  return response(400, { message });
}

/** 401 Unauthorized — missing or invalid JWT, or document ownership mismatch. */
export function unauthorized(message: string): APIGatewayProxyResult {
  return response(401, { message });
}

/** 500 Internal Server Error — unexpected failure; details are logged, not exposed. */
export function serverError(message: string): APIGatewayProxyResult {
  return response(500, { message });
}

function response(statusCode: number, body: unknown): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization'
    },
    body: JSON.stringify(body)
  };
}
