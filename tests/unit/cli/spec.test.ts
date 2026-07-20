import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSpecCommand } from '@/cli/commands/spec.js';
import { createProgram } from '@/cli/program.js';
import {
  defaultFeatureDevelopmentPolicy,
  renderDefaultFeatureDevelopmentPolicyYaml,
} from '@/pipeline/feature-development-policy.js';
import { readFeatureSpecification } from '@/feature-evidence/artifacts.js';
import { currentFeature, openFeatureChange } from '@/feature-evidence/stage-ledger.js';

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

  it('freezes a complete, confirmed spec and writes NO legacy sidecar (#343 AC-3)', async () => {
    // With the Phase-7 cutover the frozen spec's only home is the feature bundle. A
    // standalone freeze (no active feature) succeeds but persists no `.paqad/specs` sidecar.
    const path = writeSpec('S-3-widget.md', COMPLETE_SPEC);
    const { out } = await run('freeze', path, '--signed-off-by', 'alice', '--confirm-invariants');

    expect(process.exitCode).toBeUndefined();
    // The retired sidecar dir is never created.
    expect(existsSync(join(root, '.paqad/specs'))).toBe(false);
    // Narrated in the ▸ paqad voice + machine-readable confirmation; no bundle when no feature.
    expect(out.some((line) => line.startsWith('▸ paqad'))).toBe(true);
    expect(out.some((line) => line.includes('"frozen":true'))).toBe(true);
    expect(out.some((line) => line.includes('"specification":null'))).toBe(true);
  });

  it('writes the frozen spec ONLY into the active feature bundle (#343)', async () => {
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

  // Issue #401 — the freeze contract promised "no critical spec-review defects" while the
  // command evaluated the freeze with no review at all, so the clause was enforced nowhere.
  describe('spec-quality review runs inside freeze (issue #401)', () => {
    // The contradiction detector's critical case: a denominator-exclusion rule beside a
    // formula that still divides by total.
    const CRITICAL_SPEC = [
      '# Ratio spec',
      '',
      '## Functional requirements',
      '- FR-1: Indeterminate obligations are excluded from the denominator.',
      '- FR-2: The score is reported as compliance_ratio = covered / total.',
      '',
      '## Acceptance criteria',
      '- AC-1: given a report, when rendered, then it shows the ratio. (proof: automated)',
      '',
      '## Invariants',
      '- INV-1: The ratio is never negative.',
      '',
    ].join('\n');

    function activeFeature(session: string): void {
      openFeatureChange(root, session, {
        adapter: 'claude-code',
        title: 'Freeze runs the review',
        issue: '401',
        ulid: '01JABCDEFGHJKMNPQRSTVWXYZ0',
      });
    }

    it('blocks the freeze on an open critical spec-review defect (AC-1)', async () => {
      const SES = 'ses_spec_401_critical';
      activeFeature(SES);
      const path = writeSpec('S-401-critical.md', CRITICAL_SPEC);
      const { err } = await run('freeze', path, '--confirm-invariants', '--session', SES);

      expect(process.exitCode).toBe(1);
      expect(err.join('\n')).toMatch(/Critical spec-review defect open: SQ-/);
      // Nothing frozen, and the source survives so the defect can be fixed.
      const dir = currentFeature(root, SES)!;
      expect(readFeatureSpecification(root, dir)).toBeNull();
      expect(existsSync(path)).toBe(true);
    });

    it('never writes a standalone spec-review report (AC-1, AC-2)', async () => {
      const SES = 'ses_spec_401_noartifact';
      activeFeature(SES);
      // Run both paths: the blocked freeze and the clean one.
      await run(
        'freeze',
        writeSpec('S-401-blocked.md', CRITICAL_SPEC),
        '--confirm-invariants',
        '--session',
        SES,
      );
      process.exitCode = undefined;
      await run(
        'freeze',
        writeSpec('S-401-clean.md', COMPLETE_SPEC),
        '--confirm-invariants',
        '--session',
        SES,
      );
      // The stray artifact this issue was filed over is never produced by the freeze.
      expect(existsSync(join(root, '.paqad', 'compliance'))).toBe(false);
    });

    it('freezes over non-critical findings and records the defect summary (AC-2)', async () => {
      const SES = 'ses_spec_401_summary';
      activeFeature(SES);
      // "always"/"never" on a shared subject is a MAJOR contradiction — it must not block.
      const path = writeSpec(
        'S-401-major.md',
        [
          '# Widget spec',
          '',
          '## Functional requirements',
          '- FR-1: The `widget` always renders a greeting.',
          '- FR-2: The `widget` never renders a greeting for an anonymous user.',
          '',
          '## Acceptance criteria',
          '- AC-1: given a name, when rendered, then it greets the name. (proof: automated)',
          '',
          '## Invariants',
          '- INV-1: Rendering is side-effect free.',
          '',
        ].join('\n'),
      );
      await run('freeze', path, '--confirm-invariants', '--session', SES);

      expect(process.exitCode).toBeUndefined();
      const dir = currentFeature(root, SES)!;
      const summary = readFeatureSpecification(root, dir)!.spec_review!;
      expect(summary.by_severity.critical).toBe(0);
      expect(summary.by_severity.major).toBeGreaterThan(0);
      expect(summary.defect_count).toBe(
        summary.by_severity.critical + summary.by_severity.major + summary.by_severity.minor,
      );
      expect(summary.reviewed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('blocks a critical defect even with no active feature to persist into (EC-2)', async () => {
      const path = writeSpec('S-401-standalone.md', CRITICAL_SPEC);
      const { err } = await run('freeze', path, '--confirm-invariants', '--session', 'ses_none');
      expect(process.exitCode).toBe(1);
      expect(err.join('\n')).toMatch(/Critical spec-review defect open/);
    });
  });

  // Issue #401 — a spec authored in /tmp used to freeze happily, recording an absolute,
  // non-portable `spec_file` (and a `../../../..` escape in the report beside it).
  describe('out-of-tree spec files (issue #401)', () => {
    it('refuses a spec resolving outside the project root, freezing nothing (AC-3)', async () => {
      const outside = mkdtempSync(join(tmpdir(), 'paqad-outside-'));
      const path = join(outside, 'river-agent-spec.md');
      writeFileSync(path, COMPLETE_SPEC, 'utf8');
      try {
        const { err } = await run('freeze', path, '--confirm-invariants');
        expect(process.exitCode).toBe(1);
        expect(err.join('\n')).toMatch(/has to live inside the project/);
        // Refused before anything was read: the source is untouched.
        expect(existsSync(path)).toBe(true);
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
    });

    it('records spec_file as a project-relative posix path for an absolute in-tree spec (AC-5)', async () => {
      const SES = 'ses_spec_401_rel';
      openFeatureChange(root, SES, {
        adapter: 'claude-code',
        title: 'Relative spec_file',
        issue: '401',
        ulid: '01JABCDEFGHJKMNPQRSTVWXYZ0',
      });
      // Addressed by its ABSOLUTE path — the frozen record must still be relative.
      const path = writeSpec('S-401-abs.md', COMPLETE_SPEC);
      await run('freeze', path, '--confirm-invariants', '--session', SES);

      const dir = currentFeature(root, SES)!;
      const spec = readFeatureSpecification(root, dir)!;
      expect(spec.spec_file).toBe('S-401-abs.md');
      expect(spec.spec_file.startsWith('/')).toBe(false);
      expect(spec.spec_file).not.toContain('\\');
    });
  });

  it('the default specification-stage instructions name the freeze command (AC-4)', () => {
    const policy = defaultFeatureDevelopmentPolicy();
    const joined = policy.stages.specification.instructions.join('\n');
    expect(joined).toContain('paqad-ai spec freeze');
  });

  // Issue #401 — the contract is what drifted from the code, so it is asserted too. The
  // stage instructions live in two surfaces (the default policy object and the rendered
  // YAML a project is onboarded with) and previously duplicated every line verbatim.
  it('both contract surfaces describe the review freeze actually runs (AC-7)', () => {
    const fromPolicy = defaultFeatureDevelopmentPolicy()
      .stages.specification.instructions.join('\n');
    const fromYaml = renderDefaultFeatureDevelopmentPolicyYaml();

    for (const surface of [fromPolicy, fromYaml]) {
      // Says freeze runs the review itself...
      expect(surface).toContain('spec freeze` runs the spec-quality review itself');
      // ...and tells the agent not to do what produced the stray artifact.
      expect(surface).toContain('never run `compliance review` by hand');
      expect(surface).toContain('no .paqad/compliance/<slug>/spec-review.json is written');
    }
  });

  // Issue #402 — the transient markdown is scratch, not a second source of truth. Leaving
  // it behind is how a byte-identical copy of the spec ended up beside specification.json.
  describe('transient spec cleanup', () => {
    function activeFeature(): void {
      openFeatureChange(root, 'ses_spec_402', {
        adapter: 'claude-code',
        title: 'Rigid bundle only',
        issue: '402',
        ulid: '01JABCDEFGHJKMNPQRSTVWXYZ0',
      });
    }

    it('deletes the spec markdown after a successful freeze (AC-5)', async () => {
      activeFeature();
      const path = writeSpec('S-402.md', COMPLETE_SPEC);
      await run('freeze', path, '--confirm-invariants', '--session', 'ses_spec_402');
      expect(existsSync(path)).toBe(false);
      // The frozen record is what survives.
      const dir = currentFeature(root, 'ses_spec_402')!;
      expect(readFeatureSpecification(root, dir)?.frozen).toBeTruthy();
    });

    it('keeps the spec markdown with --keep-input (AC-5)', async () => {
      activeFeature();
      const path = writeSpec('S-402-keep.md', COMPLETE_SPEC);
      await run(
        'freeze',
        path,
        '--confirm-invariants',
        '--keep-input',
        '--session',
        'ses_spec_402',
      );
      expect(existsSync(path)).toBe(true);
    });

    it('never deletes the source when the freeze fails on blockers (AC-5)', async () => {
      const path = writeSpec(
        'S-402-thin.md',
        ['# Thin', '', '## Functional requirements', '- FR-1: a thing.', ''].join('\n'),
      );
      await run('freeze', path);
      expect(process.exitCode).toBe(1);
      expect(existsSync(path)).toBe(true);
    });

    // A standalone freeze persists NOTHING (no active feature to write into), so deleting
    // the source there would destroy the only copy of the spec.
    it('never deletes the source when no active feature received the spec (AC-5)', async () => {
      const path = writeSpec('S-402-standalone.md', COMPLETE_SPEC);
      const { out } = await run('freeze', path, '--confirm-invariants', '--session', 'ses_none');
      // The freeze itself succeeded, but nothing was persisted to a bundle.
      expect(out.some((line) => line.includes('"specification":null'))).toBe(true);
      expect(existsSync(path)).toBe(true);
    });

    it('refuses a spec authored inside a feature bundle dir, writing nothing (AC-6)', async () => {
      activeFeature();
      const dir = currentFeature(root, 'ses_spec_402')!;
      const bundle = join(root, '.paqad', 'ledger', 'feature-evidence', dir);
      mkdirSync(bundle, { recursive: true });
      const path = join(bundle, 'river-agent-spec.md');
      writeFileSync(path, COMPLETE_SPEC, 'utf8');
      const { err } = await run(
        'freeze',
        path,
        '--confirm-invariants',
        '--session',
        'ses_spec_402',
      );
      expect(process.exitCode).toBe(1);
      expect(err.join('\n')).toContain('holds only its rigid artifacts');
      // Refused before anything was read or written: the file is untouched.
      expect(existsSync(path)).toBe(true);
      expect(readFeatureSpecification(root, dir)).toBeNull();
    });
  });
});
