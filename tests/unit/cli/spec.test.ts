import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSpecCommand } from '@/cli/commands/spec.js';
import { createProgram } from '@/cli/program.js';
import {
  defaultFeatureDevelopmentPolicy,
  renderDefaultFeatureDevelopmentPolicyYaml,
} from '@/pipeline/feature-development-policy.js';
import { readFeatureSpecification, writeFeaturePlan } from '@/feature-evidence/artifacts.js';
import { writeProjectProfile } from '@/core/project-profile.js';

import { fixtureProfile } from '../adapters/shared.fixture.js';
import { currentFeature, openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import { featureDir, featureFilePath } from '@/feature-evidence/paths.js';
import { splitFrontMatter } from '@/feature-evidence/envelope.js';
import { sha256Hex } from '@/compliance/markdown.js';
import { writeStagedJson, writeStagedText } from '@/spec-pipeline/run-store.js';
import { buildHighTableView } from '@/hud/high-table-view.js';
import { pinSpecPipelineOff } from '../../shared/spec-pipeline-off.js';

describe('paqad-ai spec command', () => {
  let root: string;

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
    pinSpecPipelineOff(root);
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
    const path = writeSpec('S-1-thin.md', '# Thin\n\n## Behaviour\n- FR-1: does a thing.\n');
    const { err } = await run('freeze', path);

    expect(process.exitCode).toBe(1);
    expect(err.join('\n')).toContain('Spec has no acceptance criteria.');
    expect(err.join('\n')).toContain('Spec has no invariants.');
    expect(err.join('\n')).toMatch(/blocker/i);
    expect(existsSync(join(root, '.paqad/specs'))).toBe(false);
  });

  it('keeps an unconfirmed invariant a blocker unless --confirm-invariants is given (AC-2)', async () => {
    const path = writeSpec('S-2-unconfirmed.md', COMPLETE_SPEC);
    const { err } = await run('freeze', path, '--signed-off-by', 'alice');

    expect(process.exitCode).toBe(1);
    expect(err.join('\n')).toMatch(/INV-1 is not human-confirmed/);
  });

  it('freezes a complete, confirmed spec and writes NO legacy sidecar', async () => {
    const path = writeSpec('S-3-widget.md', COMPLETE_SPEC);
    const { out } = await run('freeze', path, '--signed-off-by', 'alice', '--confirm-invariants');

    expect(process.exitCode).toBeUndefined();
    expect(existsSync(join(root, '.paqad/specs'))).toBe(false);
    expect(out.some((line) => line.startsWith('**▸ paqad** · '))).toBe(true);
    expect(out.some((line) => line.includes('"frozen":true'))).toBe(true);
    expect(out.some((line) => line.includes('"specification":null'))).toBe(true);
  });

  it('writes the frozen spec ONLY into the active feature bundle', async () => {
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

  describe('spec-quality review runs inside freeze', () => {
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
      const dir = currentFeature(root, SES)!;
      expect(readFeatureSpecification(root, dir)).toBeNull();
      expect(existsSync(path)).toBe(true);
    });

    it('never writes a standalone spec-review report (AC-1, AC-2)', async () => {
      const SES = 'ses_spec_401_noartifact';
      activeFeature(SES);
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
      expect(existsSync(join(root, '.paqad', 'compliance'))).toBe(false);
    });

    it('freezes over non-critical findings and records the defect summary (AC-2)', async () => {
      const SES = 'ses_spec_401_summary';
      activeFeature(SES);
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

  describe('out-of-tree spec files', () => {
    it('refuses a spec resolving outside the project root, freezing nothing (AC-3)', async () => {
      const outside = mkdtempSync(join(tmpdir(), 'paqad-outside-'));
      const path = join(outside, 'river-agent-spec.md');
      writeFileSync(path, COMPLETE_SPEC, 'utf8');
      try {
        const { err } = await run('freeze', path, '--confirm-invariants');
        expect(process.exitCode).toBe(1);
        expect(err.join('\n')).toMatch(/has to live inside the project/);
        expect(existsSync(path)).toBe(true);
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
    });

    it('records spec_file as the bundle spec.md for an absolute in-tree spec (AC-5)', async () => {
      const SES = 'ses_spec_401_rel';
      openFeatureChange(root, SES, {
        adapter: 'claude-code',
        title: 'Relative spec_file',
        issue: '401',
        ulid: '01JABCDEFGHJKMNPQRSTVWXYZ0',
      });
      const path = writeSpec('S-401-abs.md', COMPLETE_SPEC);
      await run('freeze', path, '--confirm-invariants', '--session', SES);

      const dir = currentFeature(root, SES)!;
      const spec = readFeatureSpecification(root, dir)!;
      expect(spec.spec_file).toBe('spec.md');
      const specMd = readFileSync(join(root, featureFilePath(dir, 'specMd')), 'utf8');
      expect(sha256Hex(splitFrontMatter(specMd).body)).toBe(spec.spec_hash);
      expect(splitFrontMatter(specMd).body).toBe(COMPLETE_SPEC);
      expect(existsSync(join(root, featureDir(dir), 'specification.md'))).toBe(false);
      expect(existsSync(path)).toBe(false);
    });
  });

  it('the default specification-stage instructions name the freeze command (AC-4)', () => {
    const policy = defaultFeatureDevelopmentPolicy();
    const joined = policy.stages.specification.instructions.join('\n');
    expect(joined).toContain('paqad-ai spec freeze');
  });

  it('both contract surfaces describe the review freeze actually runs (AC-7)', () => {
    const fromPolicy =
      defaultFeatureDevelopmentPolicy().stages.specification.instructions.join('\n');
    const fromYaml = renderDefaultFeatureDevelopmentPolicyYaml();

    for (const surface of [fromPolicy, fromYaml]) {
      expect(surface).toContain('spec freeze` runs the spec-quality review itself');
      expect(surface).toContain('never run `compliance review` by hand');
      expect(surface).toContain('no .paqad/compliance/<slug>/spec-review.json is written');
    }
  });

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

    it('never deletes the source when no active feature received the spec (AC-5)', async () => {
      const path = writeSpec('S-402-standalone.md', COMPLETE_SPEC);
      const { out } = await run('freeze', path, '--confirm-invariants', '--session', 'ses_none');
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
      expect(existsSync(path)).toBe(true);
      expect(readFeatureSpecification(root, dir)).toBeNull();
    });
  });

  describe('spec pipeline adoption', () => {
    const SES = 'ses_freeze_547';
    function enablePipeline(adoption: 'warn' | 'strict' | 'off'): void {
      const lines = ['spec_pipeline_enabled=true'];
      if (adoption !== 'off') lines.push(`spec_pipeline_adoption=${adoption}`);
      writeFileSync(join(root, '.paqad', '.config'), lines.join('\n'), 'utf8');
    }
    function openFeature(): string {
      return openFeatureChange(root, SES, {
        adapter: 'claude-code',
        title: 'adoption',
        issue: '547',
        ulid: '01JABCDEFGHJKMNPQRSTVWXYZ0',
      });
    }
    function writeRun(
      dir: string,
      specMd: string,
      provenance: unknown,
      decision: Record<string, unknown> = {},
    ): void {
      writeStagedText(root, dir, 'craft', specMd);
      writeStagedJson(root, dir, 'finish', { ...decision, provenance });
    }

    it('refuses under strict when the spec is not from the pipeline and no manual reason (AC-10)', async () => {
      openFeature();
      enablePipeline('strict');
      const path = writeSpec('S-strict.md', COMPLETE_SPEC);
      const { err } = await run('freeze', path, '--session', SES, '--confirm-invariants');
      expect(process.exitCode).toBe(1);
      expect(err.join('\n')).toMatch(/spec_pipeline_adoption=strict/);
    });

    it('freezes under warn with pipeline.produced=false and prints the warn line', async () => {
      const dir = openFeature();
      enablePipeline('warn');
      const path = writeSpec('S-warn.md', COMPLETE_SPEC);
      const { out } = await run('freeze', path, '--session', SES, '--confirm-invariants');
      expect(process.exitCode).not.toBe(1);
      expect(out.join('\n')).toMatch(/frozen without the pipeline/);
      const stored = readFeatureSpecification(root, dir);
      expect(stored?.pipeline).toEqual({ produced: false });
      expect(stored && 'provenance' in stored).toBe(false);
    });

    it('freezes under strict with --manual --reason, recording the reason', async () => {
      const dir = openFeature();
      enablePipeline('strict');
      const path = writeSpec('S-manual.md', COMPLETE_SPEC);
      await run(
        'freeze',
        path,
        '--session',
        SES,
        '--confirm-invariants',
        '--manual',
        '--reason',
        'urgent hotfix',
      );
      const stored = readFeatureSpecification(root, dir);
      expect(stored?.pipeline).toEqual({ produced: false, manual_reason: 'urgent hotfix' });
      expect(stored?.task).toBeUndefined();
      expect(stored?.trace).toBeUndefined();
    });

    it('AC-45: a strict --manual --reason freeze shows the High Table as skipped on the snapshot', async () => {
      const dir = openFeature();
      enablePipeline('strict');
      const path = writeSpec('S-manual-table.md', COMPLETE_SPEC);
      await run(
        'freeze',
        path,
        '--session',
        SES,
        '--confirm-invariants',
        '--manual',
        '--reason',
        'owner wrote it',
      );
      const table = buildHighTableView(root, dir, readFeatureSpecification(root, dir), 'full');
      expect(table).toMatchObject({ skipped: true, seats: [], chief: null, credits: [] });
    });

    it('merges the staged run with --from-pipeline and refuses a hash mismatch (AC-10)', async () => {
      const dir = openFeature();
      enablePipeline('strict');
      const provenance = {
        pipeline_produced: true,
        questions: { asked: 0, answered: 0, auto_answered: 0, deferred: 0 },
        enforcement: {
          enabled: true,
          clarification: 'strict',
          final_review: 'off',
          token_ceiling: 20000,
          experts_enabled: true,
          adoption: 'strict',
        },
        a5_live: false,
        outcome: 'non-blocking-review',
        metrics: { label: 'okay', grounding_sparse: false, grounding_path: 'docs-fallback' },
        experts: { accounting: { experts: [{ role: 'db-expert' }] }, conflicts: [] },
      };
      writeRun(dir, COMPLETE_SPEC, provenance, {
        outcome: 'non-blocking-review',
        reason: 'A5 is not live',
      });
      writeStagedJson(root, dir, 'task', {
        intent: 'greet',
        scope: { frontend: ['widget'], backend: [] },
        tokens: 40,
      });
      writeStagedJson(root, dir, 'grounding', {
        references: [{ kind: 'doc', ref: 'docs/modules/widget.md' }],
        terms: ['1. Purpose'],
        sparse: true,
        path: 'docs-fallback',
      });
      writeStagedJson(root, dir, 'trace', {
        entries: [
          { id: 'FR-1', kind: 'FR', source: 'ticket:summary' },
          { id: 'AC-1', kind: 'AC', source: 'EX-db-expert-1' },
          { id: 'INV-1', kind: 'INV', source: 'ticket:invariants' },
        ],
      });
      const path = writeSpec('S-fp.md', COMPLETE_SPEC);
      await run('freeze', path, '--session', SES, '--confirm-invariants', '--from-pipeline');
      const stored = readFeatureSpecification(root, dir)!;
      expect(stored.pipeline).toEqual({
        produced: true,
        outcome: 'non-blocking-review',
        reason: 'A5 is not live',
        a5_live: false,
        enforcement: {
          clarification: 'strict',
          final_review: 'off',
          token_ceiling: 20000,
          experts_enabled: true,
          adoption: 'strict',
        },
      });
      expect(stored.task).toEqual({
        intent: 'greet',
        scope: { frontend: ['widget'], backend: [] },
      });
      expect(stored.grounding).toEqual({
        path: 'docs-fallback',
        sparse: true,
        references: [{ kind: 'doc', ref: 'docs/modules/widget.md' }],
      });
      expect(stored.trace).toEqual({
        'FR-1': 'ticket:summary',
        'AC-1': 'EX-db-expert-1',
        'INV-1': 'ticket:invariants',
      });
      expect('provenance' in stored).toBe(false);
      expect(JSON.stringify(stored)).not.toContain('run_dir');
      expect(existsSync(join(root, '.paqad', 'tmp', 'spec-pipeline'))).toBe(false);

      writeRun(dir, COMPLETE_SPEC, provenance);

      const dir2 = currentFeature(root, SES);
      expect(dir2).toBe(dir);
      const drifted = writeSpec('S-drift.md', COMPLETE_SPEC + '\n<!-- edited -->');
      process.exitCode = undefined;
      const { err } = await run(
        'freeze',
        drifted,
        '--session',
        SES,
        '--confirm-invariants',
        '--from-pipeline',
      );
      expect(process.exitCode).toBe(1);
      expect(err.join('\n')).toMatch(/not the one the pipeline crafted/);
    });

    it('writes no pipeline sections when the pipeline is off (unchanged behaviour)', async () => {
      const dir = openFeature();
      const path = writeSpec('S-off.md', COMPLETE_SPEC);
      await run('freeze', path, '--session', SES, '--confirm-invariants');
      const stored = readFeatureSpecification(root, dir)!;
      for (const key of ['provenance', 'task', 'grounding', 'pipeline', 'trace']) {
        expect(key in stored, key).toBe(false);
      }
    });

    it('freezes a fast-lane spec under strict, marking the pipeline as skipped', async () => {
      const dir = openFeatureChange(root, SES, {
        adapter: 'claude-code',
        title: 'fast copy fix',
        issue: '640',
        ulid: '01JABCDEFGHJKMNPQRSTVWXYZ3',
        lane: 'fast',
      });
      enablePipeline('strict');
      const path = writeSpec('S-fast.md', COMPLETE_SPEC);
      const { err } = await run('freeze', path, '--session', SES, '--confirm-invariants');
      expect(process.exitCode ?? 0, err.join('\n')).toBe(0);
      const stored = readFeatureSpecification(root, dir)!;
      expect(stored.pipeline).toEqual({ produced: false, skipped: 'fast-lane' });
      for (const key of ['provenance', 'task', 'grounding', 'trace']) {
        expect(key in stored, key).toBe(false);
      }
    });

    it('still refuses a hand-written spec under strict on the graduated lane', async () => {
      openFeatureChange(root, SES, {
        adapter: 'claude-code',
        title: 'graduated fix',
        issue: '640',
        ulid: '01JABCDEFGHJKMNPQRSTVWXYZ4',
        lane: 'graduated',
      });
      enablePipeline('strict');
      const path = writeSpec('S-grad.md', COMPLETE_SPEC);
      const { err } = await run('freeze', path, '--session', SES, '--confirm-invariants');
      expect(process.exitCode).toBe(1);
      expect(err.join('\n')).toMatch(/spec_pipeline_adoption=strict/);
    });

    it('refuses --from-pipeline before the run has finished', async () => {
      openFeature();
      enablePipeline('strict');
      const path = writeSpec('S-nofinish.md', COMPLETE_SPEC);
      const { err } = await run(
        'freeze',
        path,
        '--session',
        SES,
        '--confirm-invariants',
        '--from-pipeline',
      );
      expect(process.exitCode).toBe(1);
      expect(err.join('\n')).toMatch(/spec pipeline finish/);
    });

    it('refuses --from-pipeline with no active feature', async () => {
      enablePipeline('strict');
      const path = writeSpec('S-nofeature.md', COMPLETE_SPEC);
      const { err } = await run(
        'freeze',
        path,
        '--session',
        SES,
        '--confirm-invariants',
        '--from-pipeline',
      );
      expect(process.exitCode).toBe(1);
      expect(err.join('\n')).toMatch(/no active feature/);
    });

    it('merges a minimal run (finish only) from --from-pipeline', async () => {
      const dir = openFeature();
      enablePipeline('strict');
      writeRun(dir, COMPLETE_SPEC, {
        pipeline_produced: true,
        outcome: 'freeze',
        questions: { asked: 0, answered: 0, auto_answered: 0, deferred: 0 },
      });
      writeStagedJson(root, dir, 'task', { intent: 'greet' });
      const path = writeSpec('S-min.md', COMPLETE_SPEC);
      await run('freeze', path, '--session', SES, '--confirm-invariants', '--from-pipeline');
      const stored = readFeatureSpecification(root, dir)!;
      expect(stored.pipeline).toEqual({ produced: true, outcome: 'freeze' });
      expect(stored.task).toEqual({ intent: 'greet', scope: {} });
      expect(stored.grounding).toBeUndefined();
      expect(stored.trace).toBeUndefined();
    });

    it('deletes every remembered .paqad/tmp input after freeze, keeping the source on --keep-input (AC-3)', async () => {
      const dir = openFeature();
      enablePipeline('strict');
      writeRun(dir, COMPLETE_SPEC, { pipeline_produced: true, outcome: 'freeze' });
      mkdirSync(join(root, '.paqad', 'tmp'), { recursive: true });
      const path = join(root, '.paqad', 'tmp', 'S-inputs.md');
      writeFileSync(path, COMPLETE_SPEC, 'utf8');
      writeFileSync(join(root, '.paqad', 'tmp', 'need.json'), '{}', 'utf8');
      writeFileSync(join(root, '.paqad', 'tmp', 'other.json'), '{}', 'utf8');
      writeStagedJson(root, dir, 'inputs', {
        inputs: [
          '.paqad/tmp/need.json',
          '.paqad/tmp/S-inputs.md',
          '.paqad/tmp/../keep.json',
          'docs/keep.md',
        ],
      });
      writeFileSync(join(root, '.paqad', 'keep.json'), '{}', 'utf8');
      mkdirSync(join(root, 'docs'), { recursive: true });
      writeFileSync(join(root, 'docs', 'keep.md'), 'x', 'utf8');
      await run(
        'freeze',
        path,
        '--session',
        SES,
        '--confirm-invariants',
        '--from-pipeline',
        '--keep-input',
      );
      expect(process.exitCode ?? 0).toBe(0);
      expect(readdirSync(join(root, '.paqad', 'tmp')).sort()).toEqual([
        'S-inputs.md',
        'other.json',
      ]);
      expect(existsSync(join(root, '.paqad', 'keep.json'))).toBe(true);
      expect(existsSync(join(root, 'docs', 'keep.md'))).toBe(true);
    });

    it('keeps the staging root while another change is still staged there', async () => {
      const dir = openFeature();
      enablePipeline('strict');
      writeRun(dir, COMPLETE_SPEC, { pipeline_produced: true, outcome: 'freeze' });
      writeStagedJson(root, 'other-01JZZZZZZZZZZZZZZZZZZZZZZZ', 'task', { intent: 'x' });
      const path = writeSpec('S-shared.md', COMPLETE_SPEC);
      await run('freeze', path, '--session', SES, '--confirm-invariants', '--from-pipeline');
      expect(readdirSync(join(root, '.paqad', 'tmp', 'spec-pipeline'))).toEqual([
        '01JZZZZZZZZZZZZZZZZZZZZZZZ',
      ]);
    });

    it('strict --manual without --reason is refused', async () => {
      openFeature();
      enablePipeline('strict');
      const path = writeSpec('S-noreason.md', COMPLETE_SPEC);
      const { err } = await run(
        'freeze',
        path,
        '--session',
        SES,
        '--confirm-invariants',
        '--manual',
      );
      expect(process.exitCode).toBe(1);
      expect(err.join('\n')).toMatch(/--manual needs --reason/);
    });
  });

  describe('visual acceptance criterion at freeze', () => {
    const SES = 'ses_spec_visual';

    function frontendFeature(planFiles: string[]): void {
      writeProjectProfile(root, {
        ...fixtureProfile('laravel'),
        active_capabilities: ['coding'],
        stack_profile: {
          frameworks: ['react'],
          traits: [],
          toolchains: [],
          version_bands: [],
          sources: [],
        },
      } as never);
      writeFileSync(join(root, '.paqad', '.config'), 'visual_evidence=true\n');
      openFeatureChange(root, SES, { adapter: 'claude-code', ulidSeed: 11 });
      writeFeaturePlan(root, SES, {
        summary: 'goals page',
        steps: [{ id: 's1', description: 'add the page', files: planFiles }],
        reuse: {
          consulted: [{ source: 'grep', query: 'x', hits: 0 }],
          reusing: [],
          new_constructs: [],
        },
      });
    }

    function freeze(path: string) {
      return run(
        'freeze',
        path,
        '--signed-off-by',
        'alice',
        '--confirm-invariants',
        '--session',
        SES,
      );
    }

    it('AC-7: refuses a frontend spec with no (proof: visual) criterion', async () => {
      frontendFeature(['src/pages/Goals.tsx']);
      const { err } = await freeze(writeSpec('S-7-goals.md', COMPLETE_SPEC));
      expect(process.exitCode).toBe(1);
      expect(err.join('\n')).toContain(
        'Visual evidence is on and this change touches frontend files (src/pages/Goals.tsx), so at least one acceptance criterion needs (proof: visual).',
      );
      expect(readFeatureSpecification(root, currentFeature(root, SES)!)).toBeNull();
    });

    it('freezes once a criterion carries (proof: visual)', async () => {
      frontendFeature(['src/pages/Goals.tsx']);
      const visualSpec = COMPLETE_SPEC.replace(
        '(proof: automated)',
        '(proof: automated)\n- AC-2: given a goal, when saved, then the page shows it. (proof: visual)',
      );
      await freeze(writeSpec('S-8-goals.md', visualSpec));
      expect(process.exitCode).toBeUndefined();
    });

    it('AC-8: adds no requirement for a change with no frontend files', async () => {
      frontendFeature(['src/server/api.ts']);
      await freeze(writeSpec('S-9-api.md', COMPLETE_SPEC));
      expect(process.exitCode).toBeUndefined();
    });
  });
});
