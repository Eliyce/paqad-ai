import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { featureFilePath } from '@/feature-evidence/paths.js';
import { appendFeatureStageRow } from '@/feature-evidence/stage-ledger.js';

const SESSION = 'ses_backfill_script';
const DIR = 'script-change-01HW000000000000000000000A';
const AGENT = 'agent_script';

const roots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-backfill-script-'));
  roots.push(root);
  mkdirSync(join(root, featureFilePath(DIR, 'stageEvidence'), '..'), { recursive: true });
  appendFeatureStageRow(root, SESSION, DIR, {
    kind: 'stage-agent',
    stage: 'review',
    agent: 'paqad-review',
    agent_id: AGENT,
    event_status: 'completed',
    report_status: 'BLOCKED',
    report_stated: false,
    report_source: 'none',
    advance: false,
    tokens_used: 0,
    tokens_not_recarried: 0,
    estimate: false,
  });
  const transcripts = join(root, 'home/.claude/projects/p', SESSION, 'subagents');
  mkdirSync(transcripts, { recursive: true });
  writeFileSync(
    join(transcripts, `agent-${AGENT}.jsonl`),
    `${JSON.stringify({
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'All done.\n\nStatus: DONE' }],
      },
    })}\n`,
  );
  return root;
}

async function runScript(root: string, args: string[]) {
  vi.resetModules();
  vi.stubEnv('HOME', join(root, 'home'));
  vi.stubEnv('SE_SESSION', SESSION);
  vi.spyOn(process, 'cwd').mockReturnValue(root);
  const argv = vi.spyOn(process, 'argv', 'get').mockReturnValue(['node', 'script', ...args]);
  const out: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((text) => {
    out.push(String(text));
    return true;
  });
  await import('../../../scripts/backfill-stage-reports.ts');
  argv.mockRestore();
  vi.restoreAllMocks();
  return JSON.parse(out.join('')) as Array<{ dirName: string; note: string; written: boolean }>;
}

function repairRows(root: string): Array<Record<string, unknown>> {
  return readFileSync(join(root, featureFilePath(DIR, 'stageEvidence')), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((row) => row.kind === 'record-repair');
}

describe('scripts/backfill-stage-reports.ts', () => {
  it('AC-45: reports without writing, applies once, then finds nothing left', async () => {
    const root = fixture();
    const dry = await runScript(root, ['--since=2020-01-01']);
    expect(dry).toMatchObject([{ dirName: DIR, written: false }]);
    expect(dry[0]!.note).toContain(AGENT);
    expect(dry[0]!.note).toContain('DONE');
    expect(repairRows(root)).toEqual([]);

    const applied = await runScript(root, ['--since=2020-01-01', '--apply']);
    expect(applied).toMatchObject([{ dirName: DIR, written: true }]);
    expect(repairRows(root)).toHaveLength(1);

    expect(await runScript(root, ['--since=2020-01-01', '--apply'])).toEqual([]);
    expect(repairRows(root)).toHaveLength(1);
  });
});
