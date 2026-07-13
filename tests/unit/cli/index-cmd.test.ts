import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createIndexCommand } from '@/cli/commands/index-cmd.js';
import { PATHS } from '@/core/constants/paths.js';
import { createProgram } from '@/cli/program.js';

function write(root: string, rel: string, body: string): void {
  const target = join(root, rel);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, body);
}

describe('paqad-ai index command', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-cli-index-'));
    write(root, 'package.json', JSON.stringify({ dependencies: {} }));
    write(root, 'src/lib.ts', 'export function used(): void {}\nexport function dead(): void {}\n');
    write(root, 'src/app.ts', 'import { used } from "./lib.js";\nused();\n');
    write(root, 'src/cli/run.ts', 'export function run(): void {}\n');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    rmSync(root, { recursive: true, force: true });
  });

  async function run(args: string[]): Promise<{ log: string[]; out: string[] }> {
    const log: string[] = [];
    const out: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: string) => log.push(String(line)));
    vi.spyOn(console, 'error').mockImplementation((line: string) => log.push(String(line)));
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      out.push(String(chunk));
      return true;
    });
    await createIndexCommand().parseAsync(args, { from: 'user' });
    return { log, out };
  }

  it('is registered on the program', () => {
    expect(createProgram().commands.map((c) => c.name())).toContain('index');
  });

  it('build writes a schema-valid index and reports it (AC-1)', async () => {
    const { log, out } = await run(['build', '--project-root', root]);
    expect(existsSync(join(root, PATHS.CODE_KNOWLEDGE_INDEX))).toBe(true);
    expect(log.join('\n')).toContain('built the code-knowledge index');
    const summary = JSON.parse(out.join('')) as { built: boolean; symbols: number };
    expect(summary.built).toBe(true);
    expect(summary.symbols).toBeGreaterThan(0);
    expect(process.exitCode).toBeUndefined();
  });

  it('build stays quiet on the JSON line with --quiet', async () => {
    const { out } = await run(['build', '--project-root', root, '--quiet']);
    expect(out.join('')).toBe('');
  });

  it('query prints a symbol card with signature, location and callers', async () => {
    await run(['build', '--project-root', root]);
    const { log } = await run(['query', 'used', '--project-root', root]);
    const text = log.join('\n');
    expect(text).toContain('used(): void');
    expect(text).toContain('src/lib.ts:1');
    expect(text).toContain('called by 1 file');
    expect(process.exitCode).toBeUndefined();
  });

  it('query flags an unreferenced export as possible dead code', async () => {
    await run(['build', '--project-root', root]);
    const { log } = await run(['query', 'dead', '--project-root', root]);
    expect(log.join('\n')).toContain('no callers');
  });

  it('query prints a file card with importers and defined symbols for a path', async () => {
    await run(['build', '--project-root', root]);
    const { log } = await run(['query', 'src/lib.ts', '--project-root', root]);
    const text = log.join('\n');
    expect(text).toContain('src/lib.ts');
    expect(text).toContain('imported by 1 file');
    expect(text).toContain('importers: src/app.ts');
    expect(text).toContain('defines: used, dead');
  });

  it('query flags a file with no importers, and labels an entry-point file', async () => {
    await run(['build', '--project-root', root]);
    const appCard = (await run(['query', 'src/app.ts', '--project-root', root])).log.join('\n');
    expect(appCard).toContain('no importers');
    expect(appCard).toContain('defines: (no exported symbols)');

    const entryCard = (await run(['query', 'src/cli/run.ts', '--project-root', root])).log.join(
      '\n',
    );
    expect(entryCard).toContain('entry point');
  });

  it('query exits 1 for a term that is not in the index', async () => {
    await run(['build', '--project-root', root]);
    await run(['query', 'nonexistent', '--project-root', root]);
    expect(process.exitCode).toBe(1);
  });

  it('query exits 2 with a hint when no index exists yet', async () => {
    const { log } = await run(['query', 'used', '--project-root', root]);
    expect(process.exitCode).toBe(2);
    expect(log.join('\n')).toContain('run `paqad-ai index build` first');
  });

  it('build fails loudly (exit 1) without writing when the index is schema-invalid', async () => {
    const spy = vi
      .spyOn(await import('@/code-knowledge/schema.js'), 'validateCodeKnowledgeIndex')
      .mockReturnValue({ valid: false, errors: ['/symbols must be array'] });
    try {
      const { log } = await run(['build', '--project-root', root]);
      expect(process.exitCode).toBe(1);
      expect(log.join('\n')).toContain('failed schema validation');
      expect(existsSync(join(root, PATHS.CODE_KNOWLEDGE_INDEX))).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });
});
