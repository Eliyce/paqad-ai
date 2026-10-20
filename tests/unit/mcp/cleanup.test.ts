import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cleanupLegacyMcpFiles } from '@/mcp/cleanup.js';

const fsControl = vi.hoisted(() => ({ failRm: false }));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    rmSync: (...args: Parameters<typeof actual.rmSync>) => {
      if (fsControl.failRm) {
        throw new Error('EPERM: operation not permitted');
      }
      return actual.rmSync(...args);
    },
  };
});

const PAQAD_WRITTEN = JSON.stringify(
  {
    mcpServers: {
      'laravel-boost': { enabled: true, stack: 'laravel', provides: ['routes'], replaces: [] },
    },
    resolved_artifacts: [],
  },
  null,
  2,
);

const USER_OWNED = JSON.stringify(
  { mcpServers: { github: { command: 'npx', args: ['-y', '@mcp/github'] } } },
  null,
  2,
);

describe('cleanupLegacyMcpFiles', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-mcp-cleanup-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function put(path: string, content: string): void {
    const absolute = join(root, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
  }

  function log(): string {
    const path = join(root, '.paqad/logs/mcp-cleanup.log');
    return existsSync(path) ? readFileSync(path, 'utf8') : '';
  }

  it('does nothing and logs nothing when no legacy file exists', () => {
    expect(cleanupLegacyMcpFiles(root)).toEqual({ deleted: [], kept: [] });
    expect(log()).toBe('');
  });

  it('deletes a paqad-written metadata-only file (AC-6)', () => {
    put('.claude/settings.mcp.json', PAQAD_WRITTEN);
    put('.codex/mcp.json', JSON.stringify({ resolved_artifacts: ['x'] }));

    const result = cleanupLegacyMcpFiles(root);

    expect(result.deleted.sort()).toEqual(['.claude/settings.mcp.json', '.codex/mcp.json']);
    expect(existsSync(join(root, '.claude/settings.mcp.json'))).toBe(false);
    expect(existsSync(join(root, '.codex/mcp.json'))).toBe(false);
    expect(log()).toBe('');
  });

  it('keeps a file with one configured server and logs one line naming it (AC-7)', () => {
    const content = JSON.stringify({
      mcpServers: {
        'laravel-boost': { enabled: true },
        github: { command: 'npx' },
      },
      resolved_artifacts: [],
    });
    put('.cursor/mcp.json', content);

    const result = cleanupLegacyMcpFiles(root);

    expect(result).toEqual({ deleted: [], kept: ['.cursor/mcp.json'] });
    expect(readFileSync(join(root, '.cursor/mcp.json'), 'utf8')).toBe(content);
    const lines = log().trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('.cursor/mcp.json');
    expect(lines[0]).toContain('github');
  });

  it.each([
    ['url', { url: 'https://x' }],
    ['type', { type: 'stdio' }],
    ['serverUrl', { serverUrl: 'https://x' }],
    ['args', { enabled: true, args: ['-y'] }],
    ['env', { enabled: true, env: { TOKEN: 'x' } }],
    ['headers', { headers: { Authorization: 'x' } }],
    ['transport', { transport: 'sse' }],
    ['a non-object entry', 'npx thing'],
  ])('treats a server with %s as configured', (_label, server) => {
    put(
      '.windsurf/mcp.json',
      JSON.stringify({ mcpServers: { s: server }, resolved_artifacts: [] }),
    );

    expect(cleanupLegacyMcpFiles(root).kept).toEqual(['.windsurf/mcp.json']);
    expect(existsSync(join(root, '.windsurf/mcp.json'))).toBe(true);
  });

  it('keeps a user-owned file with no resolved_artifacts marker and does not log it', () => {
    put('.vscode/mcp.json', USER_OWNED);
    put('.gemini/mcp.json', JSON.stringify({ mcpServers: { a: { enabled: true } } }));

    const result = cleanupLegacyMcpFiles(root);

    expect(result.kept.sort()).toEqual(['.gemini/mcp.json', '.vscode/mcp.json']);
    expect(readFileSync(join(root, '.vscode/mcp.json'), 'utf8')).toBe(USER_OWNED);
    expect(log()).toBe('');
  });

  it('keeps a JSON array and a non-object mcpServers', () => {
    put('.continue/mcp.json', '[1, 2]');
    put('.antigravity/mcp.json', JSON.stringify({ mcpServers: [], resolved_artifacts: [] }));

    const result = cleanupLegacyMcpFiles(root);

    expect(result.kept.sort()).toEqual(['.antigravity/mcp.json', '.continue/mcp.json']);
    const lines = log().trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('.antigravity/mcp.json');
    expect(lines[0]).toContain('mcpServers is not an object');
  });

  it('keeps an unparseable file without throwing or logging (FR-6)', () => {
    put('.junie/mcp/mcp.json', '{ not json');

    const result = cleanupLegacyMcpFiles(root);

    expect(result.kept).toEqual(['.junie/mcp/mcp.json']);
    expect(readFileSync(join(root, '.junie/mcp/mcp.json'), 'utf8')).toBe('{ not json');
    expect(log()).toBe('');
  });

  it('keeps a marked file with a key paqad never wrote at the top level (VS Code servers, inputs)', () => {
    const content = JSON.stringify({ servers: { a: {} }, inputs: [], resolved_artifacts: [] });
    put('.vscode/mcp.json', content);

    expect(cleanupLegacyMcpFiles(root)).toEqual({ deleted: [], kept: ['.vscode/mcp.json'] });
    expect(readFileSync(join(root, '.vscode/mcp.json'), 'utf8')).toBe(content);
    expect(log()).toContain('holds keys paqad never wrote: servers, inputs');
  });

  it('keeps a marked file whose resolved_artifacts is not a list', () => {
    put('.codex/mcp.json', JSON.stringify({ resolved_artifacts: 'x' }));

    expect(cleanupLegacyMcpFiles(root).kept).toEqual(['.codex/mcp.json']);
    expect(log()).toContain('resolved_artifacts is not a list');
  });

  it('deletes a paqad file whose entry carries a spread profile config key', () => {
    put(
      '.cursor/mcp.json',
      JSON.stringify({
        mcpServers: { figma: { enabled: true, stack: 'react', mode: 'remote', timeout: 30 } },
        resolved_artifacts: ['a'],
      }),
    );

    expect(cleanupLegacyMcpFiles(root).deleted).toEqual(['.cursor/mcp.json']);
  });

  it('keeps and logs a paqad-written file the caller may not delete', () => {
    put('.claude/settings.mcp.json', PAQAD_WRITTEN);
    const canDelete = vi.fn(() => false);

    const result = cleanupLegacyMcpFiles(root, { canDelete });

    expect(canDelete).toHaveBeenCalledWith('.claude/settings.mcp.json');
    expect(result.kept).toEqual(['.claude/settings.mcp.json']);
    expect(existsSync(join(root, '.claude/settings.mcp.json'))).toBe(true);
    expect(log()).toContain('may not delete it');
  });

  it('deletes when the caller allows it and keeps when the check throws', () => {
    put('.claude/settings.mcp.json', PAQAD_WRITTEN);
    put('.codex/mcp.json', PAQAD_WRITTEN);

    const result = cleanupLegacyMcpFiles(root, {
      canDelete: (path) => {
        if (path === '.codex/mcp.json') {
          throw 'git missing';
        }
        return true;
      },
    });

    expect(result.deleted).toEqual(['.claude/settings.mcp.json']);
    expect(result.kept).toEqual(['.codex/mcp.json']);
    expect(log()).toContain('delete check failed: git missing');
  });

  it('keeps a paqad-written file whose delete fails and logs why', () => {
    put('.codex/mcp.json', PAQAD_WRITTEN);
    fsControl.failRm = true;

    try {
      const result = cleanupLegacyMcpFiles(root);
      expect(result).toEqual({ deleted: [], kept: ['.codex/mcp.json'] });
    } finally {
      fsControl.failRm = false;
    }
    expect(existsSync(join(root, '.codex/mcp.json'))).toBe(true);
    expect(log()).toContain('delete failed: EPERM');
  });

  it('keeps a directory sitting at a legacy path', () => {
    mkdirSync(join(root, '.codex/mcp.json'), { recursive: true });

    expect(cleanupLegacyMcpFiles(root).kept).toEqual(['.codex/mcp.json']);
  });

  it('creates the log directory and writes to stderr when the log cannot be written', () => {
    put('.vscode/mcp.json', JSON.stringify({ servers: {}, resolved_artifacts: [] }));
    put('.paqad/logs', 'not a directory');
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    expect(() => cleanupLegacyMcpFiles(root)).not.toThrow();
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('.vscode/mcp.json'));
  });
});
