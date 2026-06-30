// Must mock @aws-sdk/client-ssm before the module under test is imported.
// We store the send function on the mock factory so tests can control it.
const mockSend = jest.fn();

jest.mock('@aws-sdk/client-ssm', () => ({
  SSMClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
  GetParameterCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

describe('SSM helpers', () => {
  // Reset module registry between each test so module-level cache is cleared.
  beforeEach(() => {
    jest.resetModules();
    mockSend.mockReset();
  });

  describe('getIngestConfig', () => {
    it('returns parsed config from SSM', async () => {
      mockSend.mockResolvedValue({ Parameter: { Value: '{"chunkSize":500,"overlap":75}' } });
      const { getIngestConfig } = await import('../../common/ssm');
      const cfg = await getIngestConfig();
      expect(cfg.chunkSize).toBe(500);
      expect(cfg.overlap).toBe(75);
    });

    it('falls back to defaults when SSM throws', async () => {
      mockSend.mockRejectedValue(new Error('SSM unavailable'));
      const { getIngestConfig } = await import('../../common/ssm');
      const cfg = await getIngestConfig();
      expect(cfg.chunkSize).toBe(1000);
      expect(cfg.overlap).toBe(150);
    });

    it('fills missing keys with defaults', async () => {
      mockSend.mockResolvedValue({ Parameter: { Value: '{"chunkSize":300}' } });
      const { getIngestConfig } = await import('../../common/ssm');
      const cfg = await getIngestConfig();
      expect(cfg.chunkSize).toBe(300);
      expect(cfg.overlap).toBe(150);
    });

    it('caches the result — SSM is only called once per container lifecycle', async () => {
      mockSend.mockResolvedValue({ Parameter: { Value: '{"chunkSize":1000,"overlap":150}' } });
      const { getIngestConfig } = await import('../../common/ssm');
      await getIngestConfig();
      await getIngestConfig();
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('returns defaults when Parameter.Value is empty', async () => {
      mockSend.mockResolvedValue({ Parameter: { Value: '' } });
      const { getIngestConfig } = await import('../../common/ssm');
      const cfg = await getIngestConfig();
      expect(cfg.chunkSize).toBe(1000);
    });
  });

  describe('getQueryConfig', () => {
    it('returns parsed config from SSM', async () => {
      mockSend.mockResolvedValue({
        Parameter: { Value: '{"kNeighbours":8,"rerankedCandidates":30,"maxTokens":1000}' },
      });
      const { getQueryConfig } = await import('../../common/ssm');
      const cfg = await getQueryConfig();
      expect(cfg.kNeighbours).toBe(8);
      expect(cfg.rerankedCandidates).toBe(30);
      expect(cfg.maxTokens).toBe(1000);
    });

    it('falls back to defaults when SSM throws', async () => {
      mockSend.mockRejectedValue(new Error('SSM unavailable'));
      const { getQueryConfig } = await import('../../common/ssm');
      const cfg = await getQueryConfig();
      expect(cfg.kNeighbours).toBe(5);
      expect(cfg.rerankedCandidates).toBe(20);
      expect(cfg.maxTokens).toBe(700);
    });

    it('fills individual missing keys with defaults', async () => {
      mockSend.mockResolvedValue({ Parameter: { Value: '{"maxTokens":400}' } });
      const { getQueryConfig } = await import('../../common/ssm');
      const cfg = await getQueryConfig();
      expect(cfg.kNeighbours).toBe(5);
      expect(cfg.rerankedCandidates).toBe(20);
      expect(cfg.maxTokens).toBe(400);
    });

    it('caches the result — SSM is only called once per container lifecycle', async () => {
      mockSend.mockResolvedValue({
        Parameter: { Value: '{"kNeighbours":5,"rerankedCandidates":20,"maxTokens":700}' },
      });
      const { getQueryConfig } = await import('../../common/ssm');
      await getQueryConfig();
      await getQueryConfig();
      expect(mockSend).toHaveBeenCalledTimes(1);
    });
  });
});
