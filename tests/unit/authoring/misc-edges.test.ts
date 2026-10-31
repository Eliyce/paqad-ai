import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ACTIVATIONS_LEDGER, pruneActivations } from '@/authoring/activations.js';
import { authoringConfigProblems, readAuthoringConfig } from '@/authoring/config.js';
import {
  aggregateBenchmark,
  median,
  renderAnalyst,
  runPassRate,
  stats,
  type RunRecord,
} from '@/authoring/eval/aggregate.js';
import { scoreTriggerIterations } from '@/authoring/eval/split.js';
import { lintSkillFolder } from '@/authoring/lint/skill-lint.js';
import { enabledAdapters } from '@/authoring/paths.js';
import { runDraft } from '@/authoring/stages/draft.js';
import { runImprove } from '@/authoring/stages/improve.js';
import { skillStatus } from '@/authoring/stages/status.js';
import { scriptStemOf, skillTestLocation } from '@/authoring/tests/script-contract.js';
import { checkSkillReferences } from '@/authoring/tests/reference-checks.js';
import {
  clearWaiting,
  readGateMeta,
  renderGateMarkdown,
  setWaiting,
  SkillWorkspace,
  stageById,
} from '@/authoring/workspace.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-skill-misc-'));
  mkdirSync(join(root, '.paqad'), { recursive: true });
  mkdirSync(join(root, 'home'));
  vi.stubEnv('HOME', join(root, 'home'));
  vi.stubEnv('PAQAD_SKILL_ORCHESTRATOR_ENABLED', undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

function write(rel: string, text: string | Buffer): string {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
  return join(root, rel);
}

function run(partial: Partial<RunRecord>): RunRecord {
  return {
    case: 'c',
    arm: 'with_skill',
    tier: 'fast',
    run: 1,
    model: 'm',
    assertions: [],
    passed: 0,
    total: 0,
    tokens: null,
    duration_ms: 1,
    cost_usd: null,
    cache_hit_share: null,
    max_tool_result_tokens: null,
    truncated: false,
    ...partial,
  };
}

describe('workspace helpers', () => {
  it('refuses an unknown stage id and reads gate meta from JSON and markdown', () => {
    expect(() => stageById('S9')).toThrow('unknown skill stage S9');
    expect(readGateMeta('{"gate":"passed"}', 'json')).toEqual({ gate: 'passed' });
    expect(readGateMeta('{"no":"gate"}', 'json')).toBeNull();
    expect(readGateMeta('---\nnot: gated\n---\n', 'markdown')).toBeNull();
  });

  it('keeps other waiting stages when one clears, and status shows an answered decision', () => {
    const workspace = new SkillWorkspace(root, 'csv-dedupe');
    setWaiting(workspace, { stage: 'S1', decision: 'D-01M6000000000000000000000A', resume: 'a' });
    setWaiting(workspace, { stage: 'S4', decision: 'D-01M6000000000000000000000B', resume: 'b' });
    clearWaiting(workspace, 'S4');
    expect(workspace.readJson<unknown[]>('waiting.json')).toHaveLength(1);
    workspace.writeJson('mode.json', { entry: 'improve', source: '.claude/skills/csv-dedupe' });
    const status = skillStatus(workspace);
    expect(status.lines[0]).toBe('Entry: improve mode on csv-dedupe.');
    expect(status.lines.join('\n')).toContain('waiting on decision D-01M6000000000000000000000A');
  });

  it('reads S1 as passed in improve mode once intake.yaml exists', () => {
    const workspace = new SkillWorkspace(root, 'csv-dedupe');
    workspace.writeJson('mode.json', { entry: 'improve', source: '.claude/skills/csv-dedupe' });
    workspace.write('intake.yaml', 'purpose: x\n');
    expect(skillStatus(workspace).stages[1]!.state).toBe('passed');
  });
});

describe('aggregate and split helpers', () => {
  it('handles empty inputs and zero totals', () => {
    expect(stats([])).toEqual({ mean: 0, stddev: 0, min: 0, max: 0 });
    expect(median([3, 1, 2])).toBe(2);
    expect(runPassRate(run({ total: 0 }))).toBe(0);
    const summary = aggregateBenchmark(
      [run({ arm: 'with_skill', passed: 1, total: 1 }), run({ arm: 'with_skill', case: 'b' })],
      'without_skill',
    );
    expect(summary.pass_rate_baseline).toBe(0);
  });

  it('renders a cache-hit share below the minimum', () => {
    const text = renderAnalyst(
      {
        always_pass: [],
        always_fail: [],
        high_variance: [],
        cost_outliers: [],
        oversize_tool_results: [],
        unverifiable: [],
        cache_hit_share: 0.2,
        cache_hit_below_min: true,
      },
      null,
    );
    expect(text).toContain('0.2 (below the steady-state minimum)');
  });

  it('scores an iteration with no validation queries as null', () => {
    const scores = scoreTriggerIterations({
      queries: [{ id: 'q', query: 'q', should_trigger: true, set: 'train' }],
      iterations: [
        {
          iteration: 1,
          description: 'A. Use when asked.',
          results: [{ id: 'q', run: 1, fired: true }],
        },
      ],
      minRuns: 1,
      runs: 1,
    });
    expect(scores[0]!.validation_score).toBeNull();
  });
});

describe('config, paths and activations', () => {
  it('reports out-of-range values and falls back to the defaults', () => {
    writeFileSync(
      join(root, '.paqad/.config'),
      'authoring_runs_per_arm=\nauthoring_trigger_threshold=abc\nauthoring_otel_endpoint=ftp://x\n',
    );
    const keys = authoringConfigProblems(root).map((problem) => problem.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        'authoring_runs_per_arm',
        'authoring_trigger_threshold',
        'authoring_otel_endpoint',
      ]),
    );
    expect(readAuthoringConfig(root).authoring_runs_per_arm).toBe(3);
  });

  it('enables every adapter for an unknown manifest adapter', () => {
    write('.paqad/onboarding-manifest.json', JSON.stringify({ adapter: 'mystery' }));
    expect(enabledAdapters(root).length).toBeGreaterThan(1);
  });

  it('prunes every line away when all are old', () => {
    write(
      ACTIVATIONS_LEDGER,
      `${JSON.stringify({ skill: 's', at: '2020-01-01T00:00:00.000Z', request_id: null, session_id: 's', source: 'Skill-tool' })}\n`,
    );
    expect(pruneActivations(root, new Date('2026-10-31T00:00:00Z'), 30, true)).toBe(1);
    expect(readFileSync(join(root, ACTIVATIONS_LEDGER), 'utf8')).toBe('');
    expect(readdirSync(join(root, ACTIVATIONS_LEDGER, '..'))).toEqual(['activations.jsonl']);
  });

  it('prunes nothing and creates no ledger when the ledger is missing', () => {
    expect(pruneActivations(root, new Date('2026-10-31T00:00:00Z'), 30, true)).toBe(0);
    expect(() => readFileSync(join(root, ACTIVATIONS_LEDGER))).toThrow(/ENOENT/u);
  });
});

describe('lint, test locations and references', () => {
  it('lints a binary file inside the folder and a symlink to a binary file', () => {
    const folder = join(root, '.claude/skills/drafting-notes');
    write(
      '.claude/skills/drafting-notes/SKILL.md',
      '---\nname: drafting-notes\ndescription: Drafts notes. Use when asked.\n---\n\n# Notes\n',
    );
    write('.claude/skills/drafting-notes/assets/logo.bin', Buffer.from([0, 1, 2, 0]));
    symlinkSync('logo.bin', join(folder, 'assets/linked.bin'));
    const result = lintSkillFolder(folder, { projectRoot: root });
    expect(result.findings.some((finding) => finding.file === 'assets/linked.bin')).toBe(false);
  });

  it('places Laravel skill tests in tests/Feature/Skills and stems a dotless script', () => {
    write(
      '.paqad/project-profile.yaml',
      'project: { name: x, id: x }\nstack_profile: { frameworks: [Laravel] }\n',
    );
    expect(skillTestLocation(root, 'processing-invoices').dir).toBe(
      'tests/Feature/Skills/ProcessingInvoices',
    );
    expect(scriptStemOf('scripts/.hidden')).toBe('.hidden');
    expect(scriptStemOf('scripts/run')).toBe('run');
  });

  it('skips URLs, flags and globs in references, and sorts findings by file', () => {
    const folder = join(root, 'skill');
    write('skill/SKILL.md', '---\nname: skill\n---\n');
    write(
      'skill/references/b.md',
      'verified: 2026-10-31\n\n`https://x.test/a.md` `--flag` `src/*.ts` `missing/b.md`\n',
    );
    write('skill/references/a.md', 'verified: 2026-10-31\n\n`missing/a.md`\n');
    const findings = checkSkillReferences({ skillFolder: folder, projectRoot: root });
    expect(findings.map((finding) => finding.file)).toEqual(['references/a.md', 'references/b.md']);
  });
});

describe('draft and improve refusals', () => {
  function atS3(): SkillWorkspace {
    const workspace = new SkillWorkspace(root, 'csv-dedupe');
    for (const file of ['justification.md', 'overlap.md']) {
      workspace.write(file, renderGateMarkdown({ gate: 'passed' }, 'x'));
    }
    workspace.write('intake.yaml', 'purpose: x\n');
    workspace.write(
      'sources.md',
      '| S-ID | Fact | Origin | Date | Verified |\n| --- | --- | --- | --- | --- |\n| S-1 | f | src/a.ts | 2026-10-31 | yes |\n',
    );
    return workspace;
  }

  it('refuses a folder with no SKILL.md and copies a binary file as bytes', () => {
    const workspace = atS3();
    mkdirSync(join(root, 'empty'), { recursive: true });
    expect(() => runDraft(workspace, { dir: join(root, 'empty'), traceText: '' })).toThrow(
      'holds no SKILL.md',
    );
    write('d/csv-dedupe/SKILL.md', '---\nname: csv-dedupe\n---\n\n# Steps\n\ntext\n');
    write('d/csv-dedupe/assets/icon.bin', Buffer.from([0, 9, 0]));
    chmodSync(join(root, 'd/csv-dedupe/assets/icon.bin'), 0o640);
    const result = runDraft(workspace, {
      dir: join(root, 'd/csv-dedupe'),
      traceText:
        '| Block | Lines | S-IDs |\n| --- | --- | --- |\n| Steps | 1-3 | S-1 |\n\n## Unsourced\n\n- Steps (lines 1-3): needs a reason\n',
    });
    expect(result.ok).toBe(true);
    expect(readFileSync(workspace.path('draft/csv-dedupe/assets/icon.bin'))).toEqual(
      Buffer.from([0, 9, 0]),
    );
    expect(readdirSync(workspace.path('draft/csv-dedupe/assets'))).toEqual(['icon.bin']);
    if (process.platform !== 'win32') {
      expect(statSync(workspace.path('draft/csv-dedupe/assets/icon.bin')).mode & 0o777).toBe(0o640);
    }
  });

  it('refuses improve on a folder without SKILL.md and on a symlink inside it', () => {
    write('src-skill/readme.md', 'x');
    expect(() =>
      runImprove(new SkillWorkspace(root, 'csv-dedupe'), { source: 'src-skill' }),
    ).toThrow('holds no SKILL.md');
    write('src-skill/SKILL.md', '---\nname: csv-dedupe\n---\n');
    symlinkSync('readme.md', join(root, 'src-skill/linked.md'));
    expect(() =>
      runImprove(new SkillWorkspace(root, 'csv-dedupe'), { source: 'src-skill' }),
    ).toThrow('is a symlink');
  });

  it('points improve at evidence once intake exists, and treats tracked evidence as registered', () => {
    write('src-skill/SKILL.md', '---\nname: csv-dedupe\n---\n');
    const workspace = new SkillWorkspace(root, 'csv-dedupe');
    workspace.write('intake.yaml', 'purpose: x\n');
    expect(runImprove(workspace, { source: 'src-skill' }).lines.at(-1)).toContain(
      'S0 and S1 are skipped',
    );
    write('.paqad/authoring/skills/other-skill/evidence.json', '{}');
    expect(skillStatus(new SkillWorkspace(root, 'other-skill')).entry).toBe('improve');
  });
});

describe('reference blocks and commands', () => {
  function refs(body: string, projectFiles: Record<string, string> = {}) {
    write('rs/SKILL.md', '---\nname: rs\n---\n');
    write('rs/references/guide.md', `verified: 2026-10-31\n\n${body}`);
    for (const [rel, text] of Object.entries(projectFiles)) write(rel, text);
    return checkSkillReferences({ skillFolder: join(root, 'rs'), projectRoot: root });
  }

  it('runs runnable blocks with the default runner, passing and failing', () => {
    const findings = refs(
      '```bash runnable\nexit 0\n```\n\n```node runnable\nprocess.exit(4)\n```\n\n```runnable\nexit 0\n```\n',
    );
    expect(findings.map((finding) => finding.message)).toEqual(['The runnable block exits 4.']);
  });

  it('checks just targets, folder paths and an unparseable example target', () => {
    const findings = refs(
      '`just deploy` `just build` `docs/` `missing-dir/`\n\n```json validates=config/app.json\n{"a": 1}\n```\n\n```json validates=config/notes.txt\n{}\n```\n',
      { justfile: 'build:\n\techo ok\n', 'docs/readme.md': 'x', 'config/app.json': '{not json' },
    );
    const messages = findings.map((finding) => finding.message);
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringContaining('"just deploy" names a just target'),
        'The path missing-dir/ does not exist. Fix it or mark it external.',
        'config/app.json could not be parsed as JSON.',
        expect.stringContaining("can't be validated automatically"),
      ]),
    );
    expect(findings.map((finding) => finding.line)).toEqual(
      [...findings.map((finding) => finding.line)].sort((a, b) => a - b),
    );
  });

  it('checks composer run-script names', () => {
    const findings = refs('`composer run-script lint`\n', {
      'composer.json': JSON.stringify({ scripts: { test: 'phpunit' } }),
    });
    expect(findings[0]!.message).toContain('"composer run-script lint" names a script');
  });
});
