import { getCognitoUser, requireAuth } from '../../common/auth';
import type { APIGatewayProxyEvent } from 'aws-lambda';

function makeEvent(claims: Record<string, string> | null): APIGatewayProxyEvent {
  return {
    requestContext: {
      authorizer: claims ? { claims } : undefined,
    },
  } as unknown as APIGatewayProxyEvent;
}

describe('getCognitoUser', () => {
  it('returns null when authorizer context is absent', () => {
    expect(getCognitoUser(makeEvent(null))).toBeNull();
  });

  it('extracts userId, email, and username from claims', () => {
    const user = getCognitoUser(makeEvent({
      sub: 'user-sub-123',
      email: 'alice@example.com',
      'cognito:username': 'alice',
    }));
    expect(user).toEqual({ userId: 'user-sub-123', email: 'alice@example.com', username: 'alice' });
  });

  it('falls back to email as username when cognito:username is absent', () => {
    const user = getCognitoUser(makeEvent({
      sub: 'user-sub-456',
      email: 'bob@example.com',
    }));
    expect(user?.username).toBe('bob@example.com');
  });

  it('returns user even when email is absent', () => {
    const user = getCognitoUser(makeEvent({ sub: 'user-sub-789', 'cognito:username': 'charlie' }));
    expect(user?.userId).toBe('user-sub-789');
    expect(user?.email).toBeUndefined();
  });
});

describe('requireAuth', () => {
  it('returns the user when claims are present', () => {
    const user = requireAuth(makeEvent({ sub: 'user-sub-123', email: 'alice@example.com', 'cognito:username': 'alice' }));
    expect(user.userId).toBe('user-sub-123');
  });

  it('throws Unauthorized error when claims are absent', () => {
    expect(() => requireAuth(makeEvent(null))).toThrow('Unauthorized');
  });
});
