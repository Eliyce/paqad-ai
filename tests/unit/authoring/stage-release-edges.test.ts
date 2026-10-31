import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import YAML from 'yaml';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hashFolder, hashFolderWithoutDescription } from '@/authoring/hash.js';
import { runRelease } from '@/authoring/stages/release.js';
import { skillStatus } from '@/authoring/stages/status.js';
import { runSkillTest } from '@/authoring/stages/test.js';
import { renderGateMarkdown, SkillWorkspace } from '@/authoring/workspace.js';
import { askForOverride } from '@/authoring/stages/override.js';
import { resolvePendingDecision } from '@/decisions/authoring.js';

const NAME = 'processing-invoices';
const SCRIPT =
  '#!/usr/bin/env bash\nset -euo pipefail\nif [ "${1:-}" = "--help" ]; then\n  printf "Usage: count.sh\\n"\n  exit 0\nfi\nprintf "1\\n"\n';
const NOW = () => new Date('2026-10-31T10:00:00.000Z');
const SKILL = `---\nname: ${NAME}\ndescription: Parses supplier invoices. Use when an invoice arrives.\n---\n# Processing invoices\n\n1. Read the invoice.\n`;

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-skill-release-edges-'));
  mkdirSync(join(root, '.paqad'), { recursive: true });
  mkdirSync(join(root, 'home'));
  vi.stubEnv('HOME', join(root, 'home'));
  vi.stubEnv('USERPROFILE', join(root, 'home'));
  vi.stubEnv('PAQAD_SKILL_ORCHESTRATOR_ENABLED', undefined);
  writeFileSync(
    join(root, '.paqad/onboarding-manifest.json'),
    JSON.stringify({ adapter: 'mystery' }),
  );
  writeFileSync(
    join(root, '.paqad/project-profile.yaml'),
    YAML.stringify({ project: { name: 'x', id: 'x' }, commands: { test: 'npm test' } }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

async function ready(
  options: {
    justification?: string;
    overlap?: string;
    benchmark?: object | null;
    trigger?: object | null;
  } = {},
): Promise<SkillWorkspace> {
  const workspace = new SkillWorkspace(root, NAME);
  workspace.write(
    'justification.md',
    options.justification ?? renderGateMarkdown({ gate: 'passed' }, 'x'),
  );
  workspace.write('intake.yaml', 'purpose: x\n');
  workspace.write(
    'sources.md',
    '| S-ID | Fact | Origin | Date | Verified |\n| --- | --- | --- | --- | --- |\n| S-1 | Rates | src/a.ts | 2026-10-01 | yes |\n',
  );
  workspace.write('overlap.md', options.overlap ?? renderGateMarkdown({ gate: 'passed' }, 'x'));
  workspace.write('trace.md', renderGateMarkdown({ gate: 'passed' }, 'x'));
  workspace.write(`draft/${NAME}/SKILL.md`, SKILL);
  await runSkillTest(workspace, { runTests: async () => ({ exitCode: 0, failedTests: null }) });
  const folder = workspace.path(`draft/${NAME}`);
  workspace.writeJson('benchmark.json', {
    gate: 'passed',
    inputs_hash: hashFolderWithoutDescription(folder),
    ...(options.benchmark ?? {}),
  });
  workspace.writeJson('trigger-results.json', {
    gate: 'passed',
    inputs_hash: hashFolder(folder),
    ...(options.trigger ?? {}),
  });
  return workspace;
}

function release(workspace: SkillWorkspace, extra: { version?: string; portable?: boolean } = {}) {
  return runRelease(workspace, { sessionId: 'ses-none', now: NOW, ...extra });
}

describe('release edges', () => {
  it('refuses a version that is not x.y.z and a missing draft', async () => {
    const workspace = await ready();
    expect(() => release(workspace, { version: 'one' })).toThrow('--version must look like 1.2.3');
    workspace.remove('draft');
    expect(() => release(workspace)).toThrow('there is no draft');
  });

  it('refuses a final folder with a blocking lint finding', async () => {
    const workspace = await ready();
    workspace.write(`draft/${NAME}/SKILL.md`, SKILL.replace('---\n#', 'unknown_key: 1\n---\n#'));
    expect(() => release(workspace)).toThrow('blocking lint finding');
  });

  it('releases on an unknown host without an active change, with sparse evidence', async () => {
    const workspace = await ready({ benchmark: {}, trigger: {} });
    const result = release(workspace, { version: '2.0.0' });
    expect(result.lines.join('\n')).toContain(
      'No change is active, so no bundle record was written.',
    );
    const evidence = JSON.parse(
      readFileSync(join(root, `.paqad/authoring/skills/${NAME}/evidence.json`), 'utf8'),
    );
    expect(evidence).toMatchObject({
      version: '2.0.0',
      baseline: { passed: null, verdict: 'needed' },
      benchmark: { pass_rate_with: null, models: [], source: null },
      trigger: { validation_score: null, batch: 'not-offered' },
    });
  });

  it('records an S0 override, a no-repo source kind, and bumps the minor on a changed folder', async () => {
    const workspace = await ready({
      overlap: renderGateMarkdown({ gate: 'passed', sources_kind: 'no-repo' }, 'x'),
    });
    const ask = askForOverride(workspace, { gate: 'S0', why: 'no baseline host' });
    resolvePendingDecision(root, ask.decision!, 'add-unverified', 'ok');
    workspace.writeJson('overrides.json', [
      { gate: 'S0', reason: 'ok', by: 'human', at: '2026-10-31', decision: ask.decision },
    ]);
    release(workspace, { version: '1.4.0' });
    writeFileSync(
      join(root, `.paqad/authoring/skills/${NAME}/CHANGELOG.md`),
      '# processing-invoices\n\n## 1.4.0\n\n- first\n',
    );
    workspace.write(`draft/${NAME}/notes.md`, 'more\n');
    await runSkillTest(workspace, { runTests: async () => ({ exitCode: 0, failedTests: null }) });
    const folder = workspace.path(`draft/${NAME}`);
    workspace.writeJson('benchmark.json', {
      gate: 'passed',
      inputs_hash: hashFolderWithoutDescription(folder),
    });
    workspace.writeJson('trigger-results.json', {
      gate: 'passed',
      inputs_hash: hashFolder(folder),
    });
    release(workspace);
    const evidence = JSON.parse(
      readFileSync(join(root, `.paqad/authoring/skills/${NAME}/evidence.json`), 'utf8'),
    );
    expect(evidence.version).toBe('1.5.0');
    expect(evidence.baseline.verdict).toBe('overridden');
    expect(evidence.sources.kind).toBe('no-repo');
    expect(
      readFileSync(join(root, `.paqad/authoring/skills/${NAME}/CHANGELOG.md`), 'utf8'),
    ).toMatch(/## 1\.5\.0[\s\S]*## 1\.4\.0/u);
  });
});

describe('skill test edges', () => {
  it('refuses a missing draft and a project with no test command for a skill with scripts', async () => {
    const workspace = new SkillWorkspace(root, NAME);
    for (const file of ['justification.md', 'overlap.md', 'trace.md']) {
      workspace.write(file, renderGateMarkdown({ gate: 'passed' }, 'x'));
    }
    workspace.write('intake.yaml', 'purpose: x\n');
    await expect(runSkillTest(workspace)).rejects.toThrow('holds no draft');
    workspace.write(`draft/${NAME}/SKILL.md`, SKILL);
    workspace.write(`draft/${NAME}/scripts/count.sh`, SCRIPT);
    mkdirSync(join(root, `tests/skills/${NAME}`), { recursive: true });
    writeFileSync(
      join(root, `tests/skills/${NAME}/count.test.ts`),
      "it.skip('count help', () => {});\n",
    );
    writeFileSync(
      join(root, '.paqad/project-profile.yaml'),
      YAML.stringify({ project: { name: 'x', id: 'x' } }),
    );
    await expect(runSkillTest(workspace)).rejects.toThrow('S4 needs the project test command');
  });

  it('reports skipped and failing contract checks with their reasons', async () => {
    const workspace = new SkillWorkspace(root, NAME);
    for (const file of ['justification.md', 'overlap.md', 'trace.md']) {
      workspace.write(file, renderGateMarkdown({ gate: 'passed' }, 'x'));
    }
    workspace.write('intake.yaml', 'purpose: x\n');
    workspace.write(`draft/${NAME}/SKILL.md`, SKILL);
    workspace.write(`draft/${NAME}/scripts/count.sh`, SCRIPT);
    mkdirSync(join(root, `tests/skills/${NAME}`), { recursive: true });
    const names = [
      'help',
      'invalid input',
      'fixture output',
      'idempotency',
      'dry run',
      'output size',
      'secrets',
    ];
    writeFileSync(
      join(root, `tests/skills/${NAME}/count.test.ts`),
      names.map((check) => `it.skip('count ${check}', () => {});`).join('\n'),
    );
    const result = await runSkillTest(workspace, {
      runTests: async () => ({ exitCode: 0, failedTests: null }),
    });
    expect(result.ok).toBe(false);
    expect(result.lines.join('\n')).toContain('every test was skipped');
  });

  it('runs a command chain the runner refuses as a usage error', async () => {
    const { defaultTestRunner } = await import('@/authoring/stages/test.js');
    await expect(defaultTestRunner('echo `whoami`', root)).rejects.toThrow(
      'which skill test does not run',
    );
    expect((await defaultTestRunner('false', root)).exitCode).not.toBe(0);
  });
});

describe('status wording', () => {
  it('names the installed folder, a stopped gate and a failed gate with no detail', () => {
    writeFileSync(
      join(root, '.paqad/onboarding-manifest.json'),
      JSON.stringify({ adapter: 'claude-code' }),
    );
    mkdirSync(join(root, `.claude/skills/${NAME}`), { recursive: true });
    writeFileSync(join(root, `.claude/skills/${NAME}/SKILL.md`), SKILL);
    const workspace = new SkillWorkspace(root, NAME);
    workspace.write('justification.md', renderGateMarkdown({ gate: 'stopped' }, 'x'));
    workspace.write('intake.yaml', 'purpose: x\n');
    workspace.write('overlap.md', renderGateMarkdown({ gate: 'failed' }, 'x'));
    const status = skillStatus(workspace);
    expect(status.lines[0]).toContain(`already installed at .claude/skills/${NAME}`);
    expect(status.lines.join('\n')).toContain('S2 evidence: failed');
  });
});
