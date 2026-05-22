import {
  AdapterFactory,
  AiderAdapter,
  AntigravityAdapter,
  ClaudeCodeAdapter,
  CodexCliAdapter,
  ContinueAdapter,
  CursorAdapter,
  GeminiCliAdapter,
  GithubCopilotAdapter,
  JunieAdapter,
  WindsurfAdapter,
} from '@/adapters';

describe('AdapterFactory', () => {
  it('creates the correct adapter type', () => {
    expect(AdapterFactory.create('claude-code')).toBeInstanceOf(ClaudeCodeAdapter);
    expect(AdapterFactory.create('codex-cli')).toBeInstanceOf(CodexCliAdapter);
    expect(AdapterFactory.create('antigravity')).toBeInstanceOf(AntigravityAdapter);
    expect(AdapterFactory.create('gemini-cli')).toBeInstanceOf(GeminiCliAdapter);
    expect(AdapterFactory.create('junie')).toBeInstanceOf(JunieAdapter);
    expect(AdapterFactory.create('cursor')).toBeInstanceOf(CursorAdapter);
    expect(AdapterFactory.create('github-copilot')).toBeInstanceOf(GithubCopilotAdapter);
    expect(AdapterFactory.create('windsurf')).toBeInstanceOf(WindsurfAdapter);
    expect(AdapterFactory.create('continue')).toBeInstanceOf(ContinueAdapter);
    expect(AdapterFactory.create('aider')).toBeInstanceOf(AiderAdapter);
  });

  it('throws a clear error for an unknown adapter type at runtime', () => {
    expect(() => AdapterFactory.create('unknown-adapter' as never)).toThrowError(
      'Unsupported adapter type: unknown-adapter',
    );
  });
});
