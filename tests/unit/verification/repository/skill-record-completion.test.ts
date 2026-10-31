import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { skillCompletionFindings, skillCompletionLine } from '@/authoring/completion.js';
import { hashFolder } from '@/authoring/hash.js';
import { classifyBundlePath, strayBundleFiles } from '@/feature-evidence/bundle-integrity.js';
import { seedFeatureRecord } from '@/feature-evidence/feature-record.js';
import { bundleWriterFor, type BundleCompletenessConfig } from '@/feature-evidence/manifest.js';
import { featureDir, featureFilePath } from '@/feature-evidence/paths.js';
import { bundleCompletenessGate } from '@/verification/repository/bundle-completeness-gate.js';

const DIR = '794-add-skill-01JABCDEFGHJKMNPQRSTVWXYZ0';
const NAME = 'processing-invoices';
const SKILL_DIR = `.claude/skills/${NAME}`;

const CONFIG: BundleCompletenessConfig = {
  lane: 'full',
  ruleComplianceOn: false,
  metricsEnabled: false,
  duplicationOn: false,
  featureReport: false,
  ragEnabled: false,
  enterprise: false,
  evidenceLedger: false,
  aiBom: false,
  specPipelineStrict: false,
  specPipelineEnabled: false,
  expertsEnabled: false,
  specFrozenBeforePipeline: false,
  stageIsolationExpected: false,
  stageIsolationUnresolved: false,
};

const roots: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function write(root: string, rel: string, content: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}

function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-skill-completion-'));
  roots.push(root);
  vi.stubEnv('PAQAD_SKILL_ORCHESTRATOR_ENABLED', undefined);
  write(root, '.paqad/onboarding-manifest.json', JSON.stringify({ adapter: 'claude-code' }));
  seedFeatureRecord(root, DIR, { adapter: 'claude-code', sessionId: 'ses_1' });
  for (const key of ['plan', 'specification', 'review', 'delivery'] as const) {
    write(root, featureFilePath(DIR, key), '{"branch":"x"}');
  }
  write(root, featureFilePath(DIR, 'specMd'), '# Specification\n');
  write(root, featureFilePath(DIR, 'stageEvidence'), '{"row":1}\n');
  write(root, featureFilePath(DIR, 'evidence'), '{"code":"format"}\n');
  write(root, `${SKILL_DIR}/SKILL.md`, `---\nname: ${NAME}\ndescription: d\n---\n`);
  write(root, `${SKILL_DIR}/references/guide.md`, 'guide\n');
  return root;
}

function record(root: string, status = 'passed', folder = SKILL_DIR, name = NAME): void {
  write(
    root,
    `${featureDir(DIR)}/skill-${name}.json`,
    JSON.stringify({
      skill: name,
      status,
      version: '1.0.0',
      released_path: folder,
      folder_hash: hashFolder(join(root, folder)),
      evidence_path: `.paqad/authoring/skills/${name}/evidence.json`,
      overrides: [],
      labels: [],
    }),
  );
}

function gate(root: string, changedFiles: string[]) {
  return bundleCompletenessGate({
    projectRoot: root,
    sessionId: 'ses_1',
    dirName: DIR,
    mode: 'strict',
    origin: 'hook-completion',
    isFeatureDev: true,
    changeMetrics: null,
    config: CONFIG,
    changedFiles,
  })!;
}

describe('the skill completion check', () => {
  it('AC-30, AC-43: a new SKILL.md with no record is Needs your attention with the exact line', () => {
    const root = project();
    const result = gate(root, [`${SKILL_DIR}/SKILL.md`, 'src/a.ts']);
    expect(result.status).toBe('fail');
    expect(result.detail).toContain(
      'The skill processing-invoices changed but never went through its checks. Run paqad-ai skill status processing-invoices.',
    );
    expect(result.detail).toContain('skill-processing-invoices.json (run: paqad-ai skill release)');
  });

  it('AC-30: passes with a passing or overridden record for the shipped folder', () => {
    const root = project();
    record(root);
    expect(gate(root, [`${SKILL_DIR}/SKILL.md`]).status).toBe('pass');
    record(root, 'overridden');
    expect(gate(root, [`${SKILL_DIR}/SKILL.md`]).status).toBe('pass');
    record(root, 'failed');
    expect(gate(root, [`${SKILL_DIR}/SKILL.md`]).status).toBe('fail');
  });

  it('AC-30, INV-15: a change touching no skill path gets the same verdict as before', () => {
    const root = project();
    expect(gate(root, ['src/a.ts']).status).toBe('pass');
    expect(gate(root, []).status).toBe('pass');
  });

  it('INV-19: an edit after release reads as a missing record', () => {
    const root = project();
    record(root);
    write(root, `${SKILL_DIR}/references/guide.md`, 'edited\n');
    expect(gate(root, [`${SKILL_DIR}/references/guide.md`]).status).toBe('fail');
  });

  it('AC-56: an edit under references/ needs the record, and a rename needs skill-<new>.json', () => {
    const root = project();
    expect(
      skillCompletionFindings({
        projectRoot: root,
        dirName: DIR,
        changedFiles: [`${SKILL_DIR}/references/guide.md`],
      }),
    ).toEqual([{ skill: NAME, folder: SKILL_DIR, line: skillCompletionLine(NAME) }]);
    record(root);
    renameSync(join(root, SKILL_DIR), join(root, '.claude/skills/booking-invoices'));
    const findings = skillCompletionFindings({
      projectRoot: root,
      dirName: DIR,
      changedFiles: [`${SKILL_DIR}/SKILL.md`, '.claude/skills/booking-invoices/SKILL.md'],
    });
    expect(findings.map((finding) => finding.skill)).toEqual(['booking-invoices']);
  });

  it('AC-46, AC-48: a removed skill or one that never reached a skill root gets no finding', () => {
    const root = project();
    rmSync(join(root, SKILL_DIR), { recursive: true });
    expect(gate(root, [`${SKILL_DIR}/SKILL.md`, `${SKILL_DIR}/references/guide.md`]).status).toBe(
      'pass',
    );
  });

  it('AC-40, AC-42: with skill_orchestrator_enabled=false the verdict equals main', () => {
    const root = project();
    write(root, '.paqad/.config', 'skill_orchestrator_enabled=false\n');
    expect(gate(root, [`${SKILL_DIR}/SKILL.md`]).status).toBe('pass');
  });
});

describe('the skill record in the bundle allowlist', () => {
  it('FR-45: allows skill-<name>.json, names its writer, and still flags any other unknown file', () => {
    const root = project();
    record(root);
    write(root, `${featureDir(DIR)}/notes.json`, '{}');
    expect(strayBundleFiles(root, DIR)).toEqual(['notes.json']);
    expect(classifyBundlePath(`${featureDir(DIR)}/skill-${NAME}.json`)?.allowed).toBe(true);
    expect(classifyBundlePath(`${featureDir(DIR)}/skill-Bad.json`)?.allowed).toBe(false);
    expect(bundleWriterFor(`skill-${NAME}.json`)).toBe('paqad-ai skill release');
    expect(bundleWriterFor('notes.json')).toBeNull();
  });
});
