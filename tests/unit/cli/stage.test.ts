import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createStageCommand } from '@/cli/commands/stage.js';
import { createProgram } from '@/cli/program.js';
import { currentOrdinal, readSessionUnit } from '@/session-ledger/ledger.js';
import { STAGE_EVIDENCE_DOC_TYPE } from '@/stage-evidence/types.js';

// `paqad-ai stage <start|end> <stage>` — the shell escape hatch the block-forward
// gate's remediation names (issue #307). Unlike the never-shipped scripts/se-mark.ts
// it resolves from the installed package on every onboarded project.
describe('paqad-ai stage command', () => {
  let root: string;
  const SES = 'ses_cli_stage';

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-cli-stage-'));
    mkdirSync(join(root, '.paqad'), { recursive: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    rmSync(root, { recursive: true, force: true });
  });

  function rows() {
    const ord = currentOrdinal(root, STAGE_EVIDENCE_DOC_TYPE, SES);
    return ord > 0 ? readSessionUnit(root, STAGE_EVIDENCE_DOC_TYPE, SES, ord) : [];
  }

  async function run(...args: string[]): Promise<string[]> {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: string) => {
      lines.push(String(line));
    });
    await createStageCommand().parseAsync([...args, '--project-root', root, '--session', SES], {
      from: 'user',
    });
    return lines;
  }

  it('is registered on the program', () => {
    const names = createProgram().commands.map((command) => command.name());
    expect(names).toContain('stage');
  });

  it('records a start+end pair, script-minting the ledger rows', async () => {
    await run('start', 'planning');
    await run('end', 'planning');

    const recorded = rows();
    expect(recorded.some((r) => r.kind === 'stage_start' && r.stage === 'planning')).toBe(true);
    expect(recorded.some((r) => r.kind === 'stage_end' && r.stage === 'planning')).toBe(true);
    expect(recorded.every((r) => !r.stage || r.evidence_source === 'live-mark')).toBe(true);
  });

  it('narrates the mark in the ▸ paqad voice (ledger writes are never silent)', async () => {
    const startLines = await run('start', 'planning');
    expect(startLines.some((line) => line.startsWith('▸ paqad'))).toBe(true);

    const endLines = await run('end', 'planning');
    expect(endLines.some((line) => line.includes('evidence recorded'))).toBe(true);
    expect(endLines.some((line) => line.includes('"recorded":true'))).toBe(true);
  });

  it('rejects an unknown stage with exit code 1 and no ledger row', async () => {
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((line: string) => {
      errors.push(String(line));
    });
    await run('start', 'bogus');
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toContain('unknown stage or out-of-order');
    expect(rows()).toHaveLength(0);
  });

  it('rejects an unknown phase with exit code 1', async () => {
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((line: string) => {
      errors.push(String(line));
    });
    await run('begin', 'planning');
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toContain("use 'start' or 'end'");
  });

  it('rejects an out-of-order boundary (a later stage already began)', async () => {
    await run('start', 'review');
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((line: string) => {
      errors.push(String(line));
    });
    await run('start', 'planning');
    expect(process.exitCode).toBe(1);
  });

  // stage.ts:42 — the session-id fallback chain
  // (`--session` ?? SE_SESSION ?? CLAUDE_SESSION_ID ?? null). The block-forward gate
  // keys on the SAME resolved session, so a mark that misroutes its session would
  // silently fail to clear the block. Each fallback arm is pinned here.
  describe('session-id resolution (block-forward parity)', () => {
    /** Run WITHOUT `--session` so the fallback chain in stage.ts:42 decides the id. */
    async function runNoSession(...args: string[]): Promise<void> {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      await createStageCommand().parseAsync([...args, '--project-root', root], { from: 'user' });
    }

    function rowsFor(session: string) {
      const ord = currentOrdinal(root, STAGE_EVIDENCE_DOC_TYPE, session);
      return ord > 0 ? readSessionUnit(root, STAGE_EVIDENCE_DOC_TYPE, session, ord) : [];
    }

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('falls back to SE_SESSION when --session is absent', async () => {
      vi.stubEnv('SE_SESSION', 'ses_from_se');
      vi.stubEnv('CLAUDE_SESSION_ID', 'ses_from_claude'); // present but lower priority
      await runNoSession('start', 'planning');
      expect(rowsFor('ses_from_se').some((r) => r.kind === 'stage_start')).toBe(true);
      expect(rowsFor('ses_from_claude')).toHaveLength(0);
    });

    it('falls back to CLAUDE_SESSION_ID when --session and SE_SESSION are both absent', async () => {
      // `??` only skips null/undefined, so SE_SESSION must be UNSET (not '') to fall
      // through — the exact condition under a real hook where SE_SESSION isn't exported.
      vi.stubEnv('SE_SESSION', undefined);
      vi.stubEnv('CLAUDE_SESSION_ID', 'ses_from_claude');
      await runNoSession('start', 'planning');
      expect(rowsFor('ses_from_claude').some((r) => r.kind === 'stage_start')).toBe(true);
    });

    it('resolves the cached/minted local id when nothing is supplied (no throw)', async () => {
      vi.stubEnv('SE_SESSION', undefined);
      vi.stubEnv('CLAUDE_SESSION_ID', undefined);
      await runNoSession('start', 'planning');
      // No explicit session anywhere → resolveSessionId mints+caches a local id; the
      // mark still records (exit code stays clean, the ledger-session cache exists).
      expect(process.exitCode).toBeUndefined();
    });
  });
});
