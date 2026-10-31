import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import YAML from 'yaml';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hashFolder, hashFolderWithoutDescription } from '@/authoring/hash.js';
import { askForOverride, recordOverride } from '@/authoring/stages/override.js';
import { runRelease } from '@/authoring/stages/release.js';
import { runSkillTest } from '@/authoring/stages/test.js';
import { renderGateMarkdown, SkillWorkspace } from '@/authoring/workspace.js';
import { readContractDecisions, resolvePendingDecision } from '@/decisions/authoring.js';
import { readSkillRecord } from '@/feature-evidence/artifacts.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import { resolveSessionId } from '@/rag-ledger/session.js';

const NAME = 'processing-invoices';
const SES = 'ses-skill-release';
const NOW = () => new Date('2026-10-31T10:00:00.000Z');
const SKILL = [
  '---',
  `name: ${NAME}`,
  'description: Parses supplier invoices. Use when an invoice arrives.',
  '---',
  '# Processing invoices',
  '',
  '1. Read the invoice.',
  '',
  '## Gotchas',
  '',
  'Soft-deleted invoices stay in the table.',
  '',
].join('\n');

let root: string;
let sessionId: string;
let dir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-skill-release-'));
  mkdirSync(join(root, '.paqad'), { recursive: true });
  mkdirSync(join(root, 'home'));
  vi.stubEnv('HOME', join(root, 'home'));
  vi.stubEnv('PAQAD_SKILL_ORCHESTRATOR_ENABLED', undefined);
  writeFileSync(
    join(root, '.paqad/onboarding-manifest.json'),
    JSON.stringify({ adapter: 'claude-code' }),
  );
  writeFileSync(
    join(root, '.paqad/project-profile.yaml'),
    YAML.stringify({ project: { name: 'x', id: 'x' }, commands: { test: 'npm test' } }),
  );
  sessionId = resolveSessionId(root, SES);
  dir = openFeatureChange(root, sessionId, {
    adapter: 'claude-code',
    title: 'add invoice skill',
    lane: 'graduated',
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

async function readyWorkspace(factDate = '2026-10-01'): Promise<SkillWorkspace> {
  const workspace = new SkillWorkspace(root, NAME);
  workspace.write(
    'justification.md',
    renderGateMarkdown({ gate: 'passed', baseline_passed: 1 }, 'x'),
  );
  workspace.write('intake.yaml', 'purpose: x\n');
  workspace.write(
    'sources.md',
    `| S-ID | Fact | Origin | Date | Verified |\n| --- | --- | --- | --- | --- |\n| S-1 | Rates | https://tax.example.test | ${factDate} | yes |\n`,
  );
  workspace.write('overlap.md', renderGateMarkdown({ gate: 'passed' }, 'x'));
  workspace.write('trace.md', renderGateMarkdown({ gate: 'passed' }, 'x'));
  workspace.write(`draft/${NAME}/SKILL.md`, SKILL);
  await runSkillTest(workspace, { runTests: async () => ({ exitCode: 0, failedTests: null }) });
  const folder = workspace.path(`draft/${NAME}`);
  workspace.writeJson('benchmark.json', {
    gate: 'passed',
    inputs_hash: hashFolderWithoutDescription(folder),
    adapter: 'subagent-dispatch',
    tokens: 'measured',
    pass_rate_with: 0.9,
    pass_rate_baseline: 0.4,
    delta_points: 50,
    token_multiple: 1.2,
    models: ['fast-m', 'strong-m'],
    history: [{ iteration: 1 }],
  });
  workspace.writeJson('trigger-results.json', {
    gate: 'passed',
    inputs_hash: hashFolder(folder),
    validation_score: 0.95,
    batch: 'not-offered',
    cost_usd: 0.4,
  });
  return workspace;
}

function release(workspace: SkillWorkspace, extra: { version?: string; portable?: boolean } = {}) {
  return runRelease(workspace, { sessionId, now: NOW, ...extra });
}

describe('paqad-ai skill release (S7)', () => {
  it('AC-10: copies the skill, writes evidence.json and a CHANGELOG.md entry carrying the eval result, and records skill-<name>.json', async () => {
    const workspace = await readyWorkspace();
    const result = release(workspace);
    expect(result.lines[0]).toBe(
      `Released ${NAME} 1.0.0 into .claude/skills/${NAME}; evidence in .paqad/authoring/skills/${NAME}/evidence.json.`,
    );
    expect(readFileSync(join(root, `.claude/skills/${NAME}/SKILL.md`), 'utf8')).toBe(SKILL);
    const evidence = JSON.parse(
      readFileSync(join(root, `.paqad/authoring/skills/${NAME}/evidence.json`), 'utf8'),
    );
    expect(evidence).toMatchObject({
      schema_version: '1',
      skill: NAME,
      version: '1.0.0',
      host: 'claude-code',
      baseline: { runs: 3, passed: 1, verdict: 'needed' },
      sources: { count: 1, non_model: 1, kind: 'repo' },
      lint: { blocking: 0 },
      benchmark: { delta_points: 50, models: ['fast-m', 'strong-m'], source: 'subagent-dispatch' },
      trigger: { validation_score: 0.95 },
      overrides: [],
      labels: [],
    });
    expect(JSON.stringify(evidence)).not.toContain(String.fromCodePoint(0x2014));
    expect(readFileSync(join(root, `.paqad/authoring/skills/${NAME}/CHANGELOG.md`), 'utf8')).toBe(
      `# ${NAME}\n\n## 1.0.0\n\n- evals: 50 points over the baseline; trigger validation score 0.95\n`,
    );
    const record = readSkillRecord(root, dir, NAME)!;
    expect(record).toMatchObject({
      skill: NAME,
      status: 'passed',
      version: '1.0.0',
      released_path: `.claude/skills/${NAME}`,
    });
    expect(record.folder_hash).toBe(hashFolder(join(root, `.claude/skills/${NAME}`)));
  });

  it('AC-38: rerunning release with the same version changes nothing', async () => {
    const workspace = await readyWorkspace();
    release(workspace);
    const paths = [
      `.paqad/authoring/skills/${NAME}/evidence.json`,
      `.paqad/authoring/skills/${NAME}/CHANGELOG.md`,
      `.paqad/ledger/feature-evidence/${dir}/skill-${NAME}.json`,
    ];
    const before = paths.map((path) => readFileSync(join(root, path), 'utf8'));
    const again = release(workspace, { version: '1.0.0' });
    expect(again.lines[0]).toContain('already released with this content');
    expect(paths.map((path) => readFileSync(join(root, path), 'utf8'))).toEqual(before);
  });

  it('AC-8: refuses with no passing evals record and no override', async () => {
    const workspace = await readyWorkspace();
    workspace.remove('benchmark.json');
    expect(() => release(workspace)).toThrow("S7 release can't start: S5 evals has not passed");
    workspace.writeJson('benchmark.json', { gate: 'failed' });
    expect(() => release(workspace)).toThrow('S5 evals has not passed');
    expect(existsSync(join(root, `.claude/skills/${NAME}`))).toBe(false);
  });

  it('AC-51: refuses when the folder changed after S5 and S6, naming the stage to rerun', async () => {
    const workspace = await readyWorkspace();
    workspace.write(`draft/${NAME}/references/extra.md`, 'verified: 2026-10-31\n');
    workspace.write(`draft/${NAME}/SKILL.md`, `${SKILL}Read references/extra.md when stuck.\n`);
    expect(() => release(workspace)).toThrow('the skill changed after S4 judged it');
  });

  it('AC-20: refuses while a sources fact is older than 60 days, naming it', async () => {
    const workspace = await readyWorkspace('2026-08-01');
    expect(() => release(workspace)).toThrow(
      'S-1 "Rates" (https://tax.example.test) was verified 91 days ago, older than 60.',
    );
  });

  it('AC-55: an override from a resolved packet is recorded with by from the packet and labels the skill unverified', async () => {
    const workspace = await readyWorkspace();
    workspace.remove('benchmark.json');
    const ask = askForOverride(workspace, {
      gate: 'S5',
      why: 'The owner wants to ship before evals run.',
    });
    expect(() => recordOverride(workspace, { gate: 'S5', decision: ask.decision! })).toThrow(
      'not answered yet',
    );
    resolvePendingDecision(root, ask.decision!, 'add-unverified', 'ship it now');
    const recorded = recordOverride(workspace, { gate: 'S5', decision: ask.decision! });
    expect(recorded.lines[0]).toContain('(by human)');
    const overrides = JSON.parse(readFileSync(workspace.path('overrides.json'), 'utf8'));
    expect(overrides[0]).toMatchObject({ gate: 'S5', reason: 'ship it now', by: 'human' });
    release(workspace);
    const record = readSkillRecord(root, dir, NAME)!;
    expect(record.status).toBe('overridden');
    expect(record.labels).toEqual(['unverified']);
    expect(() => release(workspace, { portable: true })).toThrow('labelled unverified');
  });

  it('AC-55: refuses a missing decision or one of another category', async () => {
    const workspace = await readyWorkspace();
    expect(() =>
      recordOverride(workspace, { gate: 'S5', decision: 'D-01M6Z000000000000000000000' }),
    ).toThrow('There is no decision');
    expect(() => recordOverride(workspace, { gate: 'S7', decision: 'x' })).toThrow(
      '--gate must name a stage from S0 to S6',
    );
  });

  it('AC-47, INV-1: a secret can never be overridden and no packet is raised', async () => {
    const workspace = await readyWorkspace();
    workspace.writeJson('lint.json', { gate: 'failed', findings: [{ rule: 'SK-011' }] });
    expect(() => askForOverride(workspace, { gate: 'S4', why: 'skip it' })).toThrow(
      'A secret can never be approved or skipped',
    );
    expect(readContractDecisions(root)).toEqual([]);
  });

  it('AC-11: writes a portable copy that passes quick-validate', async () => {
    const workspace = await readyWorkspace();
    const result = release(workspace, { portable: true });
    expect(result.lines.some((line) => line.includes('quick-validate exits 0'))).toBe(true);
  });

  it('AC-14: warns and names the skills at risk when the catalog is over budget', async () => {
    writeFileSync(join(root, '.paqad/.config'), 'authoring_description_budget_chars=60\n');
    mkdirSync(join(root, '.claude/skills/drafting-notes'), { recursive: true });
    writeFileSync(
      join(root, '.claude/skills/drafting-notes/SKILL.md'),
      '---\nname: drafting-notes\ndescription: Drafts release notes from merged pull requests. Use when asked.\n---\n',
    );
    const workspace = await readyWorkspace();
    const result = release(workspace);
    expect(result.lines.find((line) => line.includes('over the budget of 60'))).toContain(
      'drafting-notes',
    );
  });
});
