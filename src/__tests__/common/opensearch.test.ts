// Control the OpenSearch client methods used inside fetchChunksByIds and expandWithNeighbours.
// Both functions use the same module-level client so we capture the mock instance here.
const mockSearch = jest.fn();
const mockBulk = jest.fn();

jest.mock('@opensearch-project/opensearch', () => ({
  Client: jest.fn().mockImplementation(() => ({
    search: mockSearch,
    bulk: mockBulk,
    index: jest.fn(),
    indices: { exists: jest.fn(), create: jest.fn() },
  })),
}));
jest.mock('@opensearch-project/opensearch/aws', () => ({
  AwsSigv4Signer: jest.fn().mockReturnValue({}),
}));
jest.mock('@aws-sdk/credential-provider-node', () => ({
  defaultProvider: jest.fn().mockReturnValue(jest.fn()),
}));

import { expandWithNeighbours, fetchChunksByIds } from '../../common/opensearch';
import type { SearchHit } from '../../types/document';

// Helpers to build OpenSearch response shapes and SearchHit objects.
function osHit(docId: string, idx: number, text = `text-${idx}`) {
  return {
    _id: `${docId}#${idx}`,
    _score: 1,
    _source: { chunkId: `${docId}#${idx}`, documentId: docId, fileName: 'doc.pdf', text },
  };
}
function osResponse(hits: ReturnType<typeof osHit>[]) {
  return { hits: { hits } };
}
function hit(docId: string, idx: number, text = `text-${idx}`): SearchHit {
  return { chunkId: `${docId}#${idx}`, documentId: docId, fileName: 'doc.pdf', text, score: 1 };
}

beforeEach(() => {
  mockSearch.mockReset();
  mockBulk.mockReset();
});

describe('fetchChunksByIds', () => {
  it('returns empty array without calling search when ids list is empty', async () => {
    const result = await fetchChunksByIds([]);
    expect(result).toEqual([]);
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it('maps OpenSearch hits to SearchHit objects', async () => {
    mockSearch.mockResolvedValue(osResponse([osHit('doc', 0), osHit('doc', 1)]));
    const result = await fetchChunksByIds(['doc#0', 'doc#1']);
    expect(result).toHaveLength(2);
    expect(result[0].chunkId).toBe('doc#0');
    expect(result[1].chunkId).toBe('doc#1');
  });

  it('passes chunkIds as a terms query', async () => {
    mockSearch.mockResolvedValue(osResponse([]));
    await fetchChunksByIds(['doc#0', 'doc#1']);
    const body = mockSearch.mock.calls[0][0].body;
    expect(body.query.terms.chunkId).toEqual(['doc#0', 'doc#1']);
  });
});

describe('expandWithNeighbours', () => {
  it('returns empty array when given no hits and does not call search', async () => {
    const result = await expandWithNeighbours([]);
    expect(result).toEqual([]);
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it('fetches prev and next neighbours for a single hit', async () => {
    // search returns neighbours doc#1 and doc#3
    mockSearch.mockResolvedValue(osResponse([osHit('doc', 1), osHit('doc', 3)]));
    const result = await expandWithNeighbours([hit('doc', 2)]);

    const body = mockSearch.mock.calls[0][0].body;
    expect(body.query.terms.chunkId).toContain('doc#1');
    expect(body.query.terms.chunkId).toContain('doc#3');
    expect(result.map(h => h.chunkId)).toEqual(['doc#1', 'doc#2', 'doc#3']);
  });

  it('does not fetch a negative predecessor for chunk index 0', async () => {
    mockSearch.mockResolvedValue(osResponse([osHit('doc', 1)]));
    await expandWithNeighbours([hit('doc', 0)]);

    const fetchedIds: string[] = mockSearch.mock.calls[0][0].body.query.terms.chunkId;
    expect(fetchedIds).not.toContain('doc#-1');
    expect(fetchedIds).toContain('doc#1');
  });

  it('does not re-fetch chunks already in the input set', async () => {
    // input has doc#1 and doc#2 — doc#2 is next of doc#1, already present
    mockSearch.mockResolvedValue(osResponse([osHit('doc', 0), osHit('doc', 3)]));
    await expandWithNeighbours([hit('doc', 1), hit('doc', 2)]);

    const fetchedIds: string[] = mockSearch.mock.calls[0][0].body.query.terms.chunkId;
    expect(fetchedIds).not.toContain('doc#1');
    expect(fetchedIds).not.toContain('doc#2');
  });

  it('returns results sorted by chunk index (document order)', async () => {
    mockSearch.mockResolvedValue(osResponse([osHit('doc', 4), osHit('doc', 2), osHit('doc', 6)]));
    const result = await expandWithNeighbours([hit('doc', 5), hit('doc', 3)]);
    const indices = result.map(h => parseInt(h.chunkId.split('#')[1], 10));
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
  });

  it('only requests missing neighbour when surrounding chunks are already present', async () => {
    // doc#0, doc#1, doc#2 — only doc#3 needs fetching
    mockSearch.mockResolvedValue(osResponse([]));
    await expandWithNeighbours([hit('doc', 0), hit('doc', 1), hit('doc', 2)]);
    const fetchedIds: string[] = mockSearch.mock.calls[0][0].body.query.terms.chunkId;
    expect(fetchedIds).toEqual(['doc#3']);
  });

  it('returns no duplicates after merging neighbours', async () => {
    mockSearch.mockResolvedValue(osResponse([osHit('doc', 1), osHit('doc', 3)]));
    const result = await expandWithNeighbours([hit('doc', 2)]);
    const ids = result.map(h => h.chunkId);
    expect(ids).toHaveLength(new Set(ids).size);
  });
});
