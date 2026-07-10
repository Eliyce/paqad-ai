import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSpecCommand } from '@/cli/commands/spec.js';
import { createProgram } from '@/cli/program.js';
import { defaultFeatureDevelopmentPolicy } from '@/pipeline/feature-development-policy.js';
import { readFeatureSpecification } from '@/feature-evidence/artifacts.js';
import { currentFeature, openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import type { FeatureSpec } from '@/core/types/feature-spec.js';

// `paqad-ai spec freeze <file>` — the caller that activates the built-but-dead spec
// sign-off engine (issue #317). It reimplements no freeze logic; it wires
// build → evaluate → freeze → write and refuses to freeze over blockers.
describe('paqad-ai spec command', () => {
  let root: string;

  // A spec that is complete except that its authored invariant needs confirming.
  const COMPLETE_SPEC = [
    '# Widget spec',
    '',
    '## Functional requirements',
    '- FR-1: The widget renders a greeting.',
    '',
    '## Acceptance criteria',
    '- AC-1: given a name, when rendered, then it greets the name. (proof: automated)',
    '',
    '## Invariants',
    '- INV-1: The widget never throws on empty input.',
    '',
  ].join('\n');

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-cli-spec-'));
    mkdirSync(join(root, '.paqad'), { recursive: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    rmSync(root, { recursive: true, force: true });
  });

  function writeSpec(name: string, body: string): string {
    const path = join(root, name);
    writeFileSync(path, body, 'utf8');
    return path;
  }

  async function run(...args: string[]): Promise<{ out: string[]; err: string[] }> {
    const out: string[] = [];
    const err: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: string) => {
      out.push(String(line));
    });
    vi.spyOn(console, 'error').mockImplementation((line: string) => {
      err.push(String(line));
    });
    await createSpecCommand().parseAsync([...args, '--project-root', root], { from: 'user' });
    return { out, err };
  }

  it('is registered on the program (AC-1)', () => {
    const names = createProgram().commands.map((command) => command.name());
    expect(names).toContain('spec');
  });

  it('exposes the freeze subcommand with a documented help surface (AC-1)', () => {
    const spec = createSpecCommand();
    const freeze = spec.commands.find((c) => c.name() === 'freeze');
    expect(freeze).toBeDefined();
    expect(freeze!.description()).toMatch(/freeze/i);
  });

  it('prints blockers and exits non-zero, freezing nothing, when the spec is incomplete (AC-2)', async () => {
    // Behaviour only — no acceptance criteria, no invariants ⇒ blockers.
    const path = writeSpec('S-1-thin.md', '# Thin\n\n## Behaviour\n- FR-1: does a thing.\n');
    const { err } = await run('freeze', path);

    expect(process.exitCode).toBe(1);
    expect(err.join('\n')).toContain('Spec has no acceptance criteria.');
    expect(err.join('\n')).toContain('Spec has no invariants.');
    expect(err.join('\n')).toMatch(/blocker/i);
    // Nothing frozen.
    expect(existsSync(join(root, '.paqad/specs'))).toBe(false);
  });

  it('keeps an unconfirmed invariant a blocker unless --confirm-invariants is given (AC-2)', async () => {
    const path = writeSpec('S-2-unconfirmed.md', COMPLETE_SPEC);
    const { err } = await run('freeze', path, '--signed-off-by', 'alice');

    expect(process.exitCode).toBe(1);
    expect(err.join('\n')).toMatch(/INV-1 is not human-confirmed/);
  });

  it('freezes a complete, confirmed spec and writes the frozen sidecar (AC-3)', async () => {
    const path = writeSpec('S-3-widget.md', COMPLETE_SPEC);
    const { out } = await run('freeze', path, '--signed-off-by', 'alice', '--confirm-invariants');

    expect(process.exitCode).toBeUndefined();
    const sidecar = join(root, '.paqad/specs/S-3-widget.frozen.json');
    expect(existsSync(sidecar)).toBe(true);

    const frozen = JSON.parse(readFileSync(sidecar, 'utf8')) as FeatureSpec;
    expect(frozen.frozen).not.toBeNull();
    expect(frozen.frozen!.signed_off_by).toBe('alice');
    expect(frozen.frozen!.spec_hash).toBe(frozen.spec_hash);
    expect(frozen.invariants.every((inv) => inv.confirmed)).toBe(true);
    // Narrated in the ▸ paqad voice + machine-readable confirmation.
    expect(out.some((line) => line.startsWith('▸ paqad'))).toBe(true);
    expect(out.some((line) => line.includes('"frozen":true'))).toBe(true);
  });

  it('also writes specification.json into the active feature bundle (#339)', async () => {
    const SES = 'ses_spec_feature';
    openFeatureChange(root, SES, {
      adapter: 'claude-code',
      title: 'Widget feature',
      issue: '339',
      ulid: '01JABCDEFGHJKMNPQRSTVWXYZ0',
    });
    const path = writeSpec('S-4-widget.md', COMPLETE_SPEC);
    const { out } = await run(
      'freeze',
      path,
      '--signed-off-by',
      'alice',
      '--confirm-invariants',
      '--session',
      SES,
    );
    expect(process.exitCode).toBeUndefined();
    const dir = currentFeature(root, SES)!;
    expect(readFeatureSpecification(root, dir)?.frozen?.signed_off_by).toBe('alice');
    expect(out.some((line) => line.includes('specification.json'))).toBe(true);
  });

  it('exits non-zero when the spec file cannot be read', async () => {
    const { err } = await run('freeze', join(root, 'does-not-exist.md'));
    expect(process.exitCode).toBe(1);
    expect(err.join('\n')).toMatch(/could not read spec file/);
  });

  it('the default specification-stage instructions name the freeze command (AC-4)', () => {
    const policy = defaultFeatureDevelopmentPolicy();
    const joined = policy.stages.specification.instructions.join('\n');
    expect(joined).toContain('paqad-ai spec freeze');
  });
});
