// Issue #397, decision D-01KYCFNW46E4AZC9JAAH5ZCR9P — what happens on a project where the
// TypeScript compiler cannot be resolved.
//
// This is the load-bearing consequence of making typescript an OPTIONAL peer dependency
// rather than a runtime one: paqad-ai installs into projects of any stack, and a project
// without typescript must degrade to a recorded, visible gap — never to a crash, and never
// to a silent "checked, all fine".

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/framework-api/typescript-loader.js', () => ({
  loadTypeScript: () => null,
  clearTypeScriptCache: () => {},
}));

const { nodeFrameworkApiAdapter } = await import('@/framework-api/adapters/node.js');
const { buildFrameworkApiIndex } = await import('@/framework-api/builder.js');

let root: string;

function write(rel: string, body: string): void {
  const target = join(root, rel);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, body);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-framework-api-noparser-'));
  write(
    'node_modules/react/package.json',
    JSON.stringify({ name: 'react', version: '19.2.6', types: './index.d.ts' }),
  );
  write('node_modules/react/index.d.ts', 'export declare function useId(): string;');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('with no resolvable TypeScript compiler', () => {
  it('the adapter refuses with parser-unavailable and an actionable message', () => {
    const result = nodeFrameworkApiAdapter.index({
      projectRoot: root,
      searchRoot: root,
      package: 'react',
      version: '19.2.6',
      packageDir: join(root, 'node_modules', 'react'),
    });
    expect(result).toMatchObject({ indexed: false, reason: 'parser-unavailable' });
    if (result.indexed) return;
    expect(result.detail).toContain('install typescript');
  });

  it('the build records the gap in `blocked` rather than reporting a clean check', () => {
    const { index } = buildFrameworkApiIndex(root, {
      snapshot: {
        packages: [
          {
            name: 'react',
            version_constraint: '^19.0.0',
            locked_version: '^19.0.0',
            ecosystem: 'node',
            is_dev: false,
          },
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- only `packages` is read
      } as any,
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    });
    expect(index.packages).toHaveLength(0);
    expect(index.blocked[0]).toMatchObject({ package: 'react', reason: 'parser-unavailable' });
  });
});
