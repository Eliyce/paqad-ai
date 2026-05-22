import {
  AntigravityAdapter,
  ClaudeCodeAdapter,
  CodexCliAdapter,
  CursorAdapter,
  GeminiCliAdapter,
  WindsurfAdapter,
} from '@/adapters';

type AdapterWithProtectedPaths = {
  hooksOutputPath?(): string;
  mcpOutputPath(): string;
  cacheOutputPath(): string;
  memoryOutputPath(): string;
};

describe('coverage adapter protected paths', () => {
  it('exposes protected output paths for adapters with sidecars', () => {
    const cases = [
      {
        adapter: new AntigravityAdapter(),
        expected: {
          hooks: '.antigravity/hooks.json',
          mcp: '.antigravity/mcp.json',
          cache: '.antigravity/cache.json',
          memory: '.antigravity/memory.json',
        },
      },
      {
        adapter: new ClaudeCodeAdapter(),
        expected: {
          mcp: '.claude/settings.mcp.json',
          cache: '.claude/cache.json',
          memory: '.claude/memory.json',
        },
      },
      {
        adapter: new CodexCliAdapter(),
        expected: {
          hooks: '.codex/hooks.json',
          mcp: '.codex/mcp.json',
          cache: '.codex/cache.json',
          memory: '.codex/memory.json',
        },
      },
      {
        adapter: new CursorAdapter(),
        expected: {
          hooks: '.cursor/hooks.json',
          mcp: '.cursor/mcp.json',
          cache: '.cursor/cache.json',
          memory: '.cursor/memory.json',
        },
      },
      {
        adapter: new GeminiCliAdapter(),
        expected: {
          hooks: '.gemini/hooks.json',
          mcp: '.gemini/mcp.json',
          cache: '.gemini/cache.json',
          memory: '.gemini/memory.json',
        },
      },
      {
        adapter: new WindsurfAdapter(),
        expected: {
          hooks: '.windsurf/hooks.json',
          mcp: '.windsurf/mcp.json',
          cache: '.windsurf/cache.json',
          memory: '.windsurf/memory.json',
        },
      },
    ];

    for (const { adapter, expected } of cases) {
      const typedAdapter = adapter as AdapterWithProtectedPaths;
      for (const [key, value] of Object.entries(expected)) {
        const methodName = `${key}OutputPath` as keyof AdapterWithProtectedPaths;
        expect(typedAdapter[methodName]?.()).toBe(value);
      }
    }
  });
});
