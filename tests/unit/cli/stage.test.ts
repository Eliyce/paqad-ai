import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createStageCommand } from '@/cli/commands/stage.js';
import { createProgram } from '@/cli/program.js';
import { featureFilePath } from '@/feature-evidence/paths.js';
import {
  currentFeature,
  readFeatureStageUnit,
  resolveFeatureRef,
} from '@/feature-evidence/stage-ledger.js';

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
    const dir = currentFeature(root, SES);
    return dir ? readFeatureStageUnit(root, dir) : [];
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

  it('hashes an `--artifact` on end into artifact_digest, but ignores it on start (#320)', async () => {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(root, 'findings.md'), '# findings\n');
    // `development` is a mutation stage that owns no rigid bundle file, so an arbitrary
    // in-tree artifact outside the bundle still hashes (the rigid-bundle rule binds
    // planning/specification/review). A start ignores an artifact (only an end carries one).
    await run('start', 'development', '--artifact', 'findings.md');
    await run('end', 'development', '--artifact', 'findings.md');
    const end = rows().find((r) => r.kind === 'stage_end' && r.stage === 'development');
    expect(typeof end?.artifact_digest).toBe('string');
    expect(end?.artifact_digest).toMatch(/^sha256-/);
    const start = rows().find((r) => r.kind === 'stage_start' && r.stage === 'development');
    expect(start?.artifact_digest ?? null).toBeNull();
  });

  it('leaves artifact_digest null when the --artifact file is missing (#320)', async () => {
    await run('start', 'review');
    await run('end', 'review', '--artifact', 'nope.md');
    const end = rows().find((r) => r.kind === 'stage_end' && r.stage === 'review');
    expect(end?.artifact_digest ?? null).toBeNull();
  });

  it('accepts an ABSOLUTE in-tree --artifact by normalizing it to relative (#350)', async () => {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(root, 'findings.md'), '# findings\n');
    await run('start', 'development');
    // Pass the file by its absolute path — today this silently join()ed onto root and
    // hashed as absent; now it normalizes and hashes the real bytes.
    await run('end', 'development', '--artifact', join(root, 'findings.md'));
    const end = rows().find((r) => r.kind === 'stage_end' && r.stage === 'development');
    expect(end?.artifact_digest).toMatch(/^sha256-/);
    // The stored path is the normalized relative one, not the absolute input.
    expect(end?.artifact_paths).toEqual(['findings.md']);
  });

  it('rejects an out-of-tree --artifact loudly with exit 1 and writes no row (#350)', async () => {
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((line: string) => {
      errors.push(String(line));
    });
    await run('start', 'planning');
    const before = rows().length;
    // A real file OUTSIDE the repo (the #350 repro: a scratch/temp path). It must be
    // refused at the command, not silently accepted then discovered absent later.
    await run('end', 'planning', '--artifact', join(tmpdir(), 'paqad-oot-review.md'));
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toContain('artifact must be a path inside the project');
    // No stage_end row was appended for the rejected artifact.
    expect(rows().filter((r) => r.kind === 'stage_end' && r.stage === 'planning')).toHaveLength(0);
    expect(rows().length).toBe(before);
  });

  it('ignores an out-of-tree path on a START (artifacts are end-only) (#350)', async () => {
    // A start never carries an artifact, so an out-of-tree path on a start must not
    // trip the boundary check — the start records normally.
    await run('start', 'planning', '--artifact', join(tmpdir(), 'paqad-oot.md'));
    expect(process.exitCode).toBeUndefined();
    expect(rows().some((r) => r.kind === 'stage_start' && r.stage === 'planning')).toBe(true);
  });

  it('narrates the mark in the ▸ paqad voice (ledger writes are never silent)', async () => {
    const startLines = await run('start', 'planning');
    expect(startLines.some((line) => line.startsWith('▸ paqad'))).toBe(true);

    // #325 — the end boundary is no longer spoken (muted to cut the duplicate line);
    // the ledger write is still surfaced as the recorded confirmation, so it is never
    // silent — only the second narration line is dropped.
    const endLines = await run('end', 'planning');
    expect(endLines.some((line) => line.includes('"recorded":true'))).toBe(true);
    expect(endLines.some((line) => line.includes('evidence recorded'))).toBe(false);
  });

  it('rejects an unknown stage with exit code 1 and no ledger row', async () => {
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((line: string) => {
      errors.push(String(line));
    });
    await run('start', 'bogus');
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toContain('unknown stage');
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

  it('a --title on start opens a fresh named feature (issue #339)', async () => {
    await run('start', 'planning', '--title', 'Route first workflows', '--issue', '339');
    const active = currentFeature(root, SES)!;
    expect(active.startsWith('339-route-first-workflows-')).toBe(true);
    // The titled feature is discoverable by its ref for a later `resume`.
    expect(resolveFeatureRef(root, SES, '339')).toBe(active);
    expect(rows().some((r) => r.kind === 'stage_start' && r.stage === 'planning')).toBe(true);
  });

  it('records an out-of-order boundary instead of rejecting it (issue #310 — never deadlock)', async () => {
    // A later stage already began (review); marking the earlier planning must still
    // succeed so the pre-code block is always clearable. The old CLI rejected this
    // with exit 1, which is exactly how a docs/first-edit session deadlocked.
    await run('start', 'review');
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((line: string) => {
      errors.push(String(line));
    });
    process.exitCode = 0;
    await run('start', 'planning');
    expect(process.exitCode).toBe(0);
    expect(errors).toEqual([]);
    expect(rows().some((r) => r.kind === 'stage_start' && r.stage === 'planning')).toBe(true);
  });

  // Issue #394 — a planning/specification stage-end proves itself ONLY with the active
  // bundle's rigid plan.json / specification.json. Any other in-tree file is dropped so
  // the stage folds inconclusive, and the developer is told which verb writes the real
  // artifact. Issue #402 added `review` → review.json on the same footing; a mutation
  // stage still hashes any artifact outside a bundle dir — covered above.
  describe('rigid bundle artifact for planning/specification (#394)', () => {
    /** Write a non-empty rigid bundle file into the active feature and return its rel path. */
    function writeBundleArtifact(file: 'plan' | 'specification'): string {
      const dir = currentFeature(root, SES)!;
      const rel = featureFilePath(dir, file);
      mkdirSync(join(root, dirname(rel)), { recursive: true });
      writeFileSync(join(root, rel), '{"real":true}\n');
      return rel;
    }

    it('hashes the bundle plan.json on a planning end (the accepted artifact)', async () => {
      await run('start', 'planning');
      const planRel = writeBundleArtifact('plan');
      await run('end', 'planning', '--artifact', planRel);
      const end = rows().find((r) => r.kind === 'stage_end' && r.stage === 'planning');
      expect(end?.artifact_digest).toMatch(/^sha256-/);
      expect(end?.artifact_paths).toEqual([planRel]);
    });

    it('hashes the bundle specification.json on a specification end (the accepted artifact)', async () => {
      await run('start', 'planning');
      const specRel = writeBundleArtifact('specification');
      await run('end', 'specification', '--artifact', specRel);
      const end = rows().find((r) => r.kind === 'stage_end' && r.stage === 'specification');
      expect(end?.artifact_digest).toMatch(/^sha256-/);
    });

    it('drops a non-bundle planning artifact (records inconclusive) and names `plan compile`', async () => {
      const errors: string[] = [];
      vi.spyOn(console, 'error').mockImplementation((line: string) => {
        errors.push(String(line));
      });
      await run('start', 'planning');
      // A plausible-but-wrong free-write, exactly the incident's `.paqad/features/…/plan.md`.
      writeFileSync(join(root, 'notes.md'), '# hand-written plan\n');
      const out = await run('end', 'planning', '--artifact', 'notes.md');
      // Recorded (the boundary exists) but with no digest → the fold reads inconclusive.
      const end = rows().find((r) => r.kind === 'stage_end' && r.stage === 'planning');
      expect(end).toBeDefined();
      expect(end?.artifact_digest ?? null).toBeNull();
      expect(out.some((line) => line.includes('"recorded":true'))).toBe(true);
      // Exit stays clean; the completeness verdict is the hard gate. The message names the verb.
      expect(process.exitCode).toBeUndefined();
      expect(errors.join('\n')).toContain('paqad-ai plan compile');
      expect(errors.join('\n')).toContain('inconclusive');
    });

    it('drops a non-bundle specification artifact and names `spec freeze`', async () => {
      const errors: string[] = [];
      vi.spyOn(console, 'error').mockImplementation((line: string) => {
        errors.push(String(line));
      });
      await run('start', 'planning');
      writeFileSync(join(root, 'draft-spec.md'), '# hand-written spec\n');
      await run('end', 'specification', '--artifact', 'draft-spec.md');
      const end = rows().find((r) => r.kind === 'stage_end' && r.stage === 'specification');
      expect(end?.artifact_digest ?? null).toBeNull();
      expect(errors.join('\n')).toContain('paqad-ai spec freeze');
    });
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
      const dir = currentFeature(root, session);
      return dir ? readFeatureStageUnit(root, dir) : [];
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
