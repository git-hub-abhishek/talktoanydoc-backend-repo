import { ok, badRequest, unauthorized, notFound, serverError } from '../../common/http';

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

describe('http helpers', () => {
  describe('ok', () => {
    it('returns 200 with JSON body', () => {
      const res = ok({ data: 'hello' });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ data: 'hello' });
    });

    it('includes CORS headers', () => {
      const res = ok({});
      expect(res.headers).toMatchObject(CORS_HEADERS);
    });

    it('serialises arrays correctly', () => {
      const res = ok([1, 2, 3]);
      expect(JSON.parse(res.body)).toEqual([1, 2, 3]);
    });
  });

  describe('badRequest', () => {
    it('returns 400 with message in body', () => {
      const res = badRequest('invalid input');
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body)).toEqual({ message: 'invalid input' });
    });

    it('includes CORS headers', () => {
      expect(badRequest('x').headers).toMatchObject(CORS_HEADERS);
    });
  });

  describe('unauthorized', () => {
    it('returns 401 with message in body', () => {
      const res = unauthorized('no token');
      expect(res.statusCode).toBe(401);
      expect(JSON.parse(res.body)).toEqual({ message: 'no token' });
    });

    it('includes CORS headers', () => {
      expect(unauthorized('x').headers).toMatchObject(CORS_HEADERS);
    });
  });

  describe('notFound', () => {
    it('returns 404 with message in body', () => {
      const res = notFound('not here');
      expect(res.statusCode).toBe(404);
      expect(JSON.parse(res.body)).toEqual({ message: 'not here' });
    });

    it('includes CORS headers', () => {
      expect(notFound('x').headers).toMatchObject(CORS_HEADERS);
    });
  });

  describe('serverError', () => {
    it('returns 500 with message in body', () => {
      const res = serverError('boom');
      expect(res.statusCode).toBe(500);
      expect(JSON.parse(res.body)).toEqual({ message: 'boom' });
    });

    it('includes CORS headers', () => {
      expect(serverError('x').headers).toMatchObject(CORS_HEADERS);
    });
  });
});
