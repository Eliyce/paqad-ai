import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDuplicationCommand } from '@/cli/commands/duplication.js';
import { readDuplicationReport } from '@/duplication/report.js';

import {
  commitAll,
  makeGitProject,
  writeChunkIndex,
  writeProjectFile,
} from '../duplication/helpers.js';

const HELPER = `export function formatIsoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return y + '-' + m + '-' + day + ' ' + hh + ':' + mm;
}`;
const NEAR_COPY = HELPER.replace('formatIsoDate', 'toStamp');

describe('paqad-ai duplication command', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  function trackChanged(root: string, files: string[]): void {
    writeProjectFile(root, '.paqad/session/changed-files.json', JSON.stringify(files));
  }

  async function run(root: string): Promise<string[]> {
    const out: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line?: unknown) => out.push(String(line)));
    await createDuplicationCommand().parseAsync(
      ['scan', '--project-root', root, '--no-corroborate'],
      { from: 'user' },
    );
    return out;
  }

  let root: string;
  beforeEach(() => {
    root = makeGitProject();
    writeProjectFile(root, 'src/dates.ts', `${HELPER}\n`);
    commitAll(root);
    writeChunkIndex(root, { 'src/dates.ts': HELPER });
  });

  it('reports a clean result when nothing near-copies', async () => {
    writeProjectFile(root, '.paqad/session/changed-files.json', JSON.stringify([]));
    const out = await run(root);
    expect(out.join('\n')).toContain('no new near-copies');
    expect(readDuplicationReport(root)?.findings).toEqual([]);
  });

  it('surfaces a near-copy and writes the report (warn default, no block)', async () => {
    writeProjectFile(root, 'src/stamp.ts', `${NEAR_COPY}\n`);
    trackChanged(root, ['src/stamp.ts']);
    const out = await run(root);
    expect(out.join('\n')).toContain('near-copies existing helpers');
    expect(readDuplicationReport(root)?.findings).toHaveLength(1);
    expect(process.exitCode).toBeUndefined();
  });

  it('blocks (exit 1) with a "Needs your attention" summary in strict mode', async () => {
    writeProjectFile(root, '.paqad/configs/.config.policy', 'duplication_mode=strict\n');
    writeProjectFile(root, 'src/stamp.ts', `${NEAR_COPY}\n`);
    trackChanged(root, ['src/stamp.ts']);
    const out = await run(root);
    expect(out.join('\n')).toContain('Needs your attention');
    expect(process.exitCode).toBe(1);
  });

  it('emits machine-readable JSON with --json', async () => {
    writeProjectFile(root, 'src/stamp.ts', `${NEAR_COPY}\n`);
    trackChanged(root, ['src/stamp.ts']);
    const out: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line?: unknown) => out.push(String(line)));
    await createDuplicationCommand().parseAsync(
      ['scan', '--project-root', root, '--no-corroborate', '--json'],
      { from: 'user' },
    );
    const report = JSON.parse(out.join('\n'));
    expect(report.findings).toHaveLength(1);
    expect(report.mode).toBe('warn');
  });
});
