import { SessionResumeValidator } from '@/session/resume-validator.js';

describe('SessionResumeValidator', () => {
  it('returns a no-op result when the parsed handoff is legacy or absent', async () => {
    const validator = new SessionResumeValidator({
      parse: vi.fn().mockResolvedValue({ version: 1, data: '# legacy handoff' }),
      isStructured: vi.fn().mockReturnValue(false),
    } as never);

    await expect(validator.validate('/tmp/project')).resolves.toEqual({
      rag_enabled: false,
      embedding_provider: undefined,
      index_valid: true,
      rebuild_required: false,
    });
  });

  it('returns a no-op result when structured handoff does not require RAG', async () => {
    const validator = new SessionResumeValidator({
      parse: vi.fn().mockResolvedValue({
        version: 2,
        data: { retrieval: { rag_enabled: false } },
      }),
      isStructured: vi.fn().mockReturnValue(true),
    } as never);

    await expect(validator.validate('/tmp/project')).resolves.toEqual({
      rag_enabled: false,
      embedding_provider: undefined,
      index_valid: true,
      rebuild_required: false,
    });
  });

  it('requires rebuild when the resumed RAG index is missing or invalid', async () => {
    const validator = new SessionResumeValidator(
      {
        parse: vi.fn().mockResolvedValue({
          version: 2,
          data: {
            retrieval: {
              rag_enabled: true,
              embedding_provider: 'openai',
            },
          },
        }),
        isStructured: vi.fn().mockReturnValue(true),
      } as never,
      () =>
        ({
          getStatus: vi.fn().mockResolvedValue({
            index_present: false,
            valid: false,
            reason: 'missing index',
          }),
        }) as never,
    );

    await expect(validator.validate('/tmp/project')).resolves.toEqual({
      rag_enabled: true,
      embedding_provider: 'openai',
      index_valid: false,
      rebuild_required: true,
      warning:
        'RAG index is unavailable or stale (missing index). Run `paqad-ai rag rebuild` before resuming semantic retrieval.',
    });
  });

  it('passes when the resumed RAG index is present and valid', async () => {
    const validator = new SessionResumeValidator(
      {
        parse: vi.fn().mockResolvedValue({
          version: 2,
          data: {
            retrieval: {
              rag_enabled: true,
              embedding_provider: 'voyageai',
            },
          },
        }),
        isStructured: vi.fn().mockReturnValue(true),
      } as never,
      () =>
        ({
          getStatus: vi.fn().mockResolvedValue({
            index_present: true,
            valid: true,
          }),
        }) as never,
    );

    await expect(validator.validate('/tmp/project')).resolves.toEqual({
      rag_enabled: true,
      embedding_provider: 'voyageai',
      index_valid: true,
      rebuild_required: false,
    });
  });
});
