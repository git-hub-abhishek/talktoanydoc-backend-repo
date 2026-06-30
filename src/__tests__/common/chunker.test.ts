import { chunkText } from '../../common/chunker';

const DOC_ID = 'doc-123';

describe('chunkText', () => {
  it('returns empty array for empty string', () => {
    expect(chunkText(DOC_ID, '')).toEqual([]);
  });

  it('returns empty array for whitespace-only string', () => {
    expect(chunkText(DOC_ID, '   \n\t  ')).toEqual([]);
  });

  it('returns single chunk when text fits within chunkSize', () => {
    const text = 'Hello world';
    const result = chunkText(DOC_ID, text, 1000, 150);
    expect(result).toHaveLength(1);
    expect(result[0].chunkId).toBe('doc-123#0');
    expect(result[0].text).toBe('Hello world');
  });

  it('produces deterministic chunkIds in format {documentId}#{index}', () => {
    const text = 'a'.repeat(3000);
    const result = chunkText(DOC_ID, text, 1000, 0);
    result.forEach((chunk, i) => {
      expect(chunk.chunkId).toBe(`${DOC_ID}#${i}`);
    });
  });

  it('splits long text into multiple chunks', () => {
    const text = 'a'.repeat(3000);
    const result = chunkText(DOC_ID, text, 1000, 0);
    expect(result.length).toBeGreaterThan(1);
  });

  it('each chunk does not exceed chunkSize characters', () => {
    const text = 'word '.repeat(500);
    const result = chunkText(DOC_ID, text, 200, 50);
    result.forEach(chunk => {
      expect(chunk.text.length).toBeLessThanOrEqual(200);
    });
  });

  it('overlap carries content from previous chunk into next', () => {
    // 300 chars with chunkSize=200, overlap=100 — second chunk should start
    // with content that also appeared at the end of the first chunk
    const text = Array.from({ length: 30 }, (_, i) => `word${i}`).join(' ');
    const result = chunkText(DOC_ID, text, 50, 20);
    expect(result.length).toBeGreaterThanOrEqual(2);
    // The second chunk starts within the overlap region of the first
    const firstEnd = result[0].text.slice(-20);
    expect(result[1].text.startsWith(firstEnd.trimStart()) ||
      result[1].text.includes(firstEnd.trim())).toBe(true);
  });

  it('normalises internal whitespace to single spaces', () => {
    const text = 'hello   world\n\nfoo\tbar';
    const result = chunkText(DOC_ID, text, 1000, 0);
    expect(result[0].text).toBe('hello world foo bar');
  });

  it('is idempotent — same input always produces same output', () => {
    const text = 'The quick brown fox jumps over the lazy dog. '.repeat(50);
    const first  = chunkText(DOC_ID, text, 200, 50);
    const second = chunkText(DOC_ID, text, 200, 50);
    expect(first).toEqual(second);
  });

  it('respects custom chunkSize and overlap parameters', () => {
    const text = 'x'.repeat(1000);
    const small = chunkText(DOC_ID, text, 100, 0);
    const large = chunkText(DOC_ID, text, 500, 0);
    expect(small.length).toBeGreaterThan(large.length);
  });

  it('handles text exactly equal to chunkSize in one chunk', () => {
    const text = 'a'.repeat(100);
    const result = chunkText(DOC_ID, text, 100, 0);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe(text);
  });

  it('handles single-character text', () => {
    const result = chunkText(DOC_ID, 'x', 1000, 150);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('x');
  });

  it('different documentIds produce different chunkIds', () => {
    const text = 'hello world';
    const a = chunkText('doc-A', text);
    const b = chunkText('doc-B', text);
    expect(a[0].chunkId).not.toBe(b[0].chunkId);
    expect(a[0].text).toBe(b[0].text);
  });
});
