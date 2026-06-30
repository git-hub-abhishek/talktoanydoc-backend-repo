jest.mock('@aws-sdk/client-s3');
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://s3.example.com/presigned'),
}));
jest.mock('../../common/logger', () => ({
  setRequestId: jest.fn(),
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { handler } from '../../handlers/generate-presigned-url';
import type { APIGatewayProxyEvent, Context } from 'aws-lambda';

const CONTEXT = { awsRequestId: 'test-req-id' } as Context;

function makeEvent(params: Record<string, string>, userId = 'user-1'): APIGatewayProxyEvent {
  return {
    queryStringParameters: params,
    requestContext: {
      authorizer: {
        claims: { sub: userId, email: 'user@test.com', 'cognito:username': 'testuser' },
      },
    },
  } as unknown as APIGatewayProxyEvent;
}

const VALID_PARAMS = {
  fileName: 'report.pdf',
  contentType: 'application/pdf',
  fileSize: '1024',
};

describe('GET /generate-url handler', () => {
  it('returns 401 when no auth context is present', async () => {
    const event = {
      queryStringParameters: VALID_PARAMS,
      requestContext: { authorizer: undefined },
    } as unknown as APIGatewayProxyEvent;
    const res = await handler(event, CONTEXT);
    expect(res.statusCode).toBe(401);
  });

  it('returns 400 when fileName is missing', async () => {
    const { fileName: _, ...rest } = VALID_PARAMS;
    const res = await handler(makeEvent(rest), CONTEXT);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).message).toMatch(/fileName/);
  });

  it('returns 400 when contentType is missing', async () => {
    const { contentType: _, ...rest } = VALID_PARAMS;
    const res = await handler(makeEvent(rest), CONTEXT);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).message).toMatch(/contentType/);
  });

  it('returns 400 when fileSize is missing', async () => {
    const { fileSize: _, ...rest } = VALID_PARAMS;
    const res = await handler(makeEvent(rest), CONTEXT);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).message).toMatch(/fileSize/);
  });

  it('returns 400 for disallowed MIME type', async () => {
    const res = await handler(makeEvent({ ...VALID_PARAMS, contentType: 'image/png' }), CONTEXT);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).message).toMatch(/file type/i);
  });

  it('returns 400 for disallowed file extension', async () => {
    const res = await handler(
      makeEvent({ ...VALID_PARAMS, fileName: 'file.exe', contentType: 'application/pdf' }),
      CONTEXT,
    );
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).message).toMatch(/extension/i);
  });

  it('returns 400 for non-numeric fileSize', async () => {
    const res = await handler(makeEvent({ ...VALID_PARAMS, fileSize: 'abc' }), CONTEXT);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).message).toMatch(/fileSize/);
  });

  it('returns 400 for zero fileSize', async () => {
    const res = await handler(makeEvent({ ...VALID_PARAMS, fileSize: '0' }), CONTEXT);
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when file exceeds max size', async () => {
    const oversizedBytes = (100 * 1024 * 1024 + 1).toString();
    const res = await handler(makeEvent({ ...VALID_PARAMS, fileSize: oversizedBytes }), CONTEXT);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).message).toMatch(/size/i);
  });

  it('returns 200 with uploadUrl, documentId, and fileKey for valid PDF', async () => {
    const res = await handler(makeEvent(VALID_PARAMS), CONTEXT);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.uploadUrl).toBe('https://s3.example.com/presigned');
    expect(typeof body.documentId).toBe('string');
    expect(body.fileKey).toMatch(/^uploads\/.+\/report\.pdf$/);
  });

  it('returns 200 for valid .docx upload', async () => {
    const res = await handler(makeEvent({
      fileName: 'doc.docx',
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      fileSize: '2048',
    }), CONTEXT);
    expect(res.statusCode).toBe(200);
  });

  it('sanitises special characters in fileName', async () => {
    const res = await handler(makeEvent({ ...VALID_PARAMS, fileName: 'my report (v2).pdf' }), CONTEXT);
    expect(res.statusCode).toBe(200);
    const { fileKey } = JSON.parse(res.body);
    expect(fileKey).toMatch(/my_report__v2_\.pdf$/);
  });
});
