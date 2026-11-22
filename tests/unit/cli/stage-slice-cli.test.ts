import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createStageCommand } from '@/cli/commands/stage.js';
import { leadGuideText } from '@/cli/commands/stage-slice.js';
import { featureFilePath } from '@/feature-evidence/paths.js';

import { commitAll, makeEmptyRepo, writeRepoFile } from '../pipeline/changed-files.fixture.js';
import { openChange } from '../traceability/change-map.fixture.js';

const SES = 'ses_stage_slice_cli';

const PLAN = {
  summary: 's',
  workstreams: [
    {
      id: 'store',
      owned_files: ['src/store/**', 'tests/store/**'],
      acs: ['AC-1'],
      depends_on: [],
      provides_seams: [],
      uses_seams: [],
      risk: 'high',
      size_budget: { files: 10 },
    },
  ],
  waves: [['store']],
  joining: [],
};

describe('paqad-ai stage slice commands, in process', () => {
  let root: string;
  let out: string[];
  let err: string[];

  beforeEach(() => {
    vi.stubEnv('SE_AGENT_ID', undefined);
    vi.stubEnv('SE_SESSION', undefined);
    vi.stubEnv('CLAUDE_SESSION_ID', undefined);
    vi.stubEnv('CLAUDE_CODE_SESSION_ID', undefined);
    vi.stubEnv('PAQAD_STAGE_AGENT', undefined);
    root = makeEmptyRepo('main');
    writeRepoFile(root, 'README.md', 'x\n');
    commitAll(root, 'base');
    out = [];
    err = [];
    vi.spyOn(console, 'log').mockImplementation((line: string) => void out.push(String(line)));
    vi.spyOn(console, 'error').mockImplementation((line: string) => void err.push(String(line)));
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      out.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    process.exitCode = undefined;
    rmSync(root, { recursive: true, force: true });
  });

  const run = async (...args: string[]) => {
    await createStageCommand().parseAsync([...args, '--project-root', root, '--session', SES], {
      from: 'user',
    });
  };

  const withPlan = () => {
    const dir = openChange(root, SES);
    writeFileSync(join(root, featureFilePath(dir, 'plan')), JSON.stringify(PLAN));
    return dir;
  };

  it('AC-44 prints the lead guide for brief development --lead', async () => {
    await run('brief', 'development', '--lead');
    expect(out.join('')).toBe(leadGuideText());
  });

  it('AC-26 prints the slice brief for a planned workstream and refuses one outside the plan', async () => {
    await run('brief', 'development', 'store', '--lead');
    expect(err.at(-1)).toBe('slice "store" is not in the compiled plan of the active change');
    process.exitCode = undefined;
    withPlan();
    await run('brief', 'development', 'store', '--lead');
    expect(out.join('')).toContain('# Slice store');
    expect(process.exitCode).toBeUndefined();
    await run('brief', 'development', 'nope', '--lead');
    expect(err.at(-1)).toBe('slice "nope" is not in the compiled plan of the active change');
    expect(process.exitCode).toBe(1);
  });

  it('AC-45 report slices prints an empty list and fails without a compiled plan', async () => {
    await run('report', 'slices');
    expect(out).toEqual([JSON.stringify({ slices: [] })]);
    expect(process.exitCode).toBe(1);
  });

  it('AC-21 AC-45 runs slice phases, prints a raised packet and reports the blocked slice', async () => {
    withPlan();
    vi.stubEnv('SE_AGENT_ID', ' ag-store ');
    writeRepoFile(root, 'src/store/rows.ts', 'export const rows = 1;\n');
    writeRepoFile(root, 'tests/store/rows.test.ts', "it('reads rows', () => 1);\n");
    await run('slice', 'start', 'store');
    expect(out).toContain('slice store started');
    await run('slice', 'gate', 'store');
    expect(err.at(-1)).toMatch(/slice store gate failed: ac tag: no owned test names AC-1/);
    expect(process.exitCode).toBe(1);
    await run('slice', 'gate', 'store');
    expect(err.at(-1)).toMatch(/^\*\*▸ paqad\*\* · raised D-\S+ for slice store$/);
    out = [];
    process.exitCode = undefined;
    await run('report', 'slices');
    expect(JSON.parse(out[0]!).slices).toEqual([
      expect.objectContaining({ id: 'store', status: 'BLOCKED', gate_failures: 2 }),
    ]);
    expect(process.exitCode).toBeUndefined();
  });

  it('AC-35 a slice command with no workstream fails on its own', async () => {
    withPlan();
    await run('slice', 'gate');
    expect(err.at(-1)).toBe('**▸ paqad** · name the workstream to gate');
    expect(process.exitCode).toBe(1);
  });
});
