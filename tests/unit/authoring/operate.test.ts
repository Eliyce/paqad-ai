import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ACTIVATIONS_LEDGER,
  forEachActivation,
  lastFiredBySkill,
  pruneActivations,
} from '@/authoring/activations.js';
import { buildSkillCatalogReport } from '@/authoring/catalog.js';
import { appendAuthoringDefect } from '@/authoring/evidence.js';
import { lintSkillFolder } from '@/authoring/lint/skill-lint.js';
import { runJustify } from '@/authoring/stages/justify.js';
import {
  appendGotcha,
  resolveLearn,
  runCatalog,
  runDrift,
  runLearn,
} from '@/authoring/stages/operate.js';
import { SkillWorkspace } from '@/authoring/workspace.js';
import { readContractDecisions, resolvePendingDecision } from '@/decisions/authoring.js';

const NOW = new Date('2026-10-31T12:00:00.000Z');
const SKILL = (name: string, description: string, extra = '') =>
  `---\nname: ${name}\ndescription: ${description}\n${extra}---\n# ${name}\n\n1. Do the job.\n\n## Gotchas\n\nOne known trap.\n`;

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-skill-operate-'));
  mkdirSync(join(root, '.paqad'), { recursive: true });
  writeFileSync(
    join(root, '.paqad/onboarding-manifest.json'),
    JSON.stringify({ adapter: 'claude-code' }),
  );
  vi.stubEnv('PAQAD_SKILL_ORCHESTRATOR_ENABLED', undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

function write(rel: string, text: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
}

function activations(rows: Array<{ skill: string; at: string }>, trailingNewline = true): void {
  const text = rows
    .map((row) =>
      JSON.stringify({ ...row, request_id: null, session_id: 's', source: 'Skill-tool' }),
    )
    .join('\n');
  write(ACTIVATIONS_LEDGER, trailingNewline ? `${text}\n` : text);
}

describe('the activation ledger', () => {
  it('streams every line, including a last line with no newline', () => {
    activations(
      [
        { skill: 'a', at: '2026-10-30T00:00:00.000Z' },
        { skill: 'a', at: '2026-10-29T00:00:00.000Z' },
        { skill: 'b', at: '2026-10-01T00:00:00.000Z' },
      ],
      false,
    );
    const seen: string[] = [];
    forEachActivation(root, (activation) => seen.push(activation.skill));
    expect(seen).toEqual(['a', 'a', 'b']);
    expect(lastFiredBySkill(root)).toEqual(
      new Map([
        ['a', '2026-10-30T00:00:00.000Z'],
        ['b', '2026-10-01T00:00:00.000Z'],
      ]),
    );
  });

  it('NFR-11: prunes lines older than twice the dark window only past 1 MB unless forced', () => {
    activations([
      { skill: 'a', at: '2026-10-30T00:00:00.000Z' },
      { skill: 'old', at: '2026-07-01T00:00:00.000Z' },
    ]);
    expect(pruneActivations(root, NOW, 30)).toBe(0);
    expect(pruneActivations(root, NOW, 30, true)).toBe(1);
    expect(readFileSync(join(root, ACTIVATIONS_LEDGER), 'utf8')).not.toContain('old');
  });
});

describe('paqad-ai skill catalog', () => {
  beforeEach(() => {
    write(
      '.claude/skills/booking-invoices/SKILL.md',
      SKILL(
        'booking-invoices',
        'Books supplier invoices into the ledger. Use when an invoice arrives.',
      ),
    );
    write(
      '.claude/skills/filing-invoices/SKILL.md',
      SKILL(
        'filing-invoices',
        'Books supplier invoices into the ledger. Use when an invoice arrives.',
      ),
    );
    write(
      '.claude/skills/drafting-notes/SKILL.md',
      SKILL('drafting-notes', 'Drafts release notes. Use when asked.', 'user-invocable: true\n'),
    );
  });

  it('reports trigger rate, dark skills with their listing cost, rivals and user-invoked skills', () => {
    activations([
      { skill: 'booking-invoices', at: '2026-10-30T00:00:00.000Z' },
      { skill: 'booking-invoices', at: '2026-10-29T00:00:00.000Z' },
      { skill: 'drafting-notes', at: '2026-10-28T00:00:00.000Z' },
      { skill: 'filing-invoices', at: '2026-09-15T00:00:00.000Z' },
    ]);
    const report = buildSkillCatalogReport({
      projectRoot: root,
      host: 'claude-code',
      now: NOW,
      darkWindowDays: 30,
      collisionThreshold: 0.4,
    });
    const byName = Object.fromEntries(report.skills.map((row) => [row.skill, row]));
    expect(byName['booking-invoices']).toMatchObject({
      fires: 2,
      trigger_rate: 0.667,
      dark: false,
    });
    expect(byName['filing-invoices']).toMatchObject({
      fires: 0,
      dark: true,
      last_fired: '2026-09-15T00:00:00.000Z',
    });
    expect(byName['filing-invoices']!.listing_chars).toBeGreaterThan(0);
    expect(byName['drafting-notes']!.user_invoked_without_disable).toBe(true);
    expect(report.rivals.map((rival) => [rival.left, rival.right])).toEqual([
      ['booking-invoices', 'filing-invoices'],
    ]);
  });

  it('AC-49: counts the skills added (evidence.json) and refused (defects.jsonl)', () => {
    write(
      '.paqad/authoring/skills/booking-invoices/evidence.json',
      JSON.stringify({ skill: 'booking-invoices' }),
    );
    write('.paqad/authoring/skills/broken/evidence.json', '{bad');
    appendAuthoringDefect(root, {
      skill: 'tax-helper',
      gate: 'S5',
      evidence_path: 'x',
      at: NOW.toISOString(),
    });
    appendAuthoringDefect(root, {
      skill: 'tax-helper',
      gate: 'S6',
      evidence_path: 'y',
      at: NOW.toISOString(),
    });
    appendAuthoringDefect(root, {
      skill: 'other',
      gate: 'S4',
      evidence_path: 'z',
      at: NOW.toISOString(),
    });
    const result = runCatalog(root, { now: () => NOW });
    expect(result.lines[0]).toBe('Skills added through their checks: 1. Skills refused: 2.');
  });

  it('FR-46: says activation data: none on a host with no activation hook', () => {
    writeFileSync(
      join(root, '.paqad/onboarding-manifest.json'),
      JSON.stringify({ adapter: 'codex-cli' }),
    );
    write(
      '.codex/skills/booking-invoices/SKILL.md',
      SKILL('booking-invoices', 'Books invoices. Use when one arrives.'),
    );
    const result = runCatalog(root, { now: () => NOW });
    expect(result.lines).toContain('activation data: none on codex-cli');
    expect(result.lines.some((line) => line.includes('no activation data'))).toBe(true);
  });

  it('raises authoring.retirement for each dark skill when asked', () => {
    activations([{ skill: 'booking-invoices', at: '2026-10-30T00:00:00.000Z' }]);
    runCatalog(root, { now: () => NOW, proposeRetirement: true });
    const packets = readContractDecisions(root).map((row) => row.packet);
    expect(packets.map((packet) => [packet.category, packet.title])).toEqual(
      expect.arrayContaining([
        ['authoring.retirement', 'Retire the skill drafting-notes?'],
        ['authoring.retirement', 'Retire the skill filing-invoices?'],
      ]),
    );
    expect(packets.every((packet) => packet.recommendation === 'retire')).toBe(true);
  });

  it('EC-10: proposes retiring an installed skill whose baseline now passes', () => {
    const workspace = new SkillWorkspace(root, 'booking-invoices');
    for (const run of [1, 2, 3]) workspace.write(`baseline/run-${run}.md`, 'x');
    workspace.writeJson(
      'baseline/verdicts.json',
      [1, 2, 3].map((run) => ({ run, passed: true, note: 'ok' })),
    );
    const result = runJustify(workspace);
    expect(result.decision).toBeDefined();
    expect(readContractDecisions(root)[0]!.packet.category).toBe('authoring.retirement');
  });
});

describe('paqad-ai skill learn', () => {
  beforeEach(() => {
    write(
      '.claude/skills/booking-invoices/SKILL.md',
      SKILL('booking-invoices', 'Books invoices. Use when one arrives.'),
    );
  });

  it('AC-10, EC-13: on yes the correction lands under ## Gotchas with a date and an S-ID, in a project-scoped draft', () => {
    const workspace = new SkillWorkspace(root, 'booking-invoices');
    const asked = runLearn(workspace, {
      correction: 'Credit notes carry a negative total.',
      scope: 'this repository',
      source: 'S-4',
    });
    const packet = readContractDecisions(root)[0]!.packet;
    expect(packet.category).toBe('authoring.improvement');
    expect(packet.recommendation).toBe('improve');
    resolvePendingDecision(root, asked.decision!, 'improve', 'yes');
    const result = resolveLearn(workspace, { decision: asked.decision!, now: () => NOW });
    expect(result.lines[0]).toContain('Rerun its checks from paqad-ai skill test booking-invoices');
    const draft = readFileSync(workspace.path('draft/booking-invoices/SKILL.md'), 'utf8');
    expect(draft).toContain(
      '## Gotchas\n\nOne known trap.\n- learned 2026-10-31 in this repository (S-4): Credit notes carry a negative total.\n',
    );
    expect(
      readFileSync(join(root, '.claude/skills/booking-invoices/SKILL.md'), 'utf8'),
    ).not.toContain('learned');
    expect(workspace.exists('skill-snapshot/SKILL.md')).toBe(true);
    const lint = lintSkillFolder(workspace.path('draft/booking-invoices'), { projectRoot: root });
    expect(lint.findings.filter((finding) => finding.rule === 'SK-017')).toEqual([]);
  });

  it('on no it changes nothing', () => {
    const workspace = new SkillWorkspace(root, 'booking-invoices');
    const asked = runLearn(workspace, { correction: 'x', scope: 'here', source: 'S-1' });
    resolvePendingDecision(root, asked.decision!, 'leave', 'no');
    expect(resolveLearn(workspace, { decision: asked.decision! }).lines[0]).toContain('unchanged');
    expect(workspace.exists('draft')).toBe(false);
  });

  it('refuses without an S-ID or for a skill that is not installed', () => {
    expect(() =>
      runLearn(new SkillWorkspace(root, 'booking-invoices'), {
        correction: 'x',
        scope: 'y',
        source: 'z',
      }),
    ).toThrow('S-ID');
    expect(() =>
      runLearn(new SkillWorkspace(root, 'missing-skill'), {
        correction: 'x',
        scope: 'y',
        source: 'S-1',
      }),
    ).toThrow('no installed skill');
  });

  it('appends a Gotchas section when the skill has none', () => {
    expect(appendGotcha('# Body\n', '- learned x')).toBe('# Body\n\n## Gotchas\n\n- learned x\n');
  });
});

describe('paqad-ai skill drift', () => {
  it('AC-20, AC-36: lists external facts older than 60 days and writes drift.md', () => {
    const workspace = new SkillWorkspace(root, 'booking-invoices');
    workspace.write(
      'sources.md',
      '| S-ID | Fact | Origin | Date | Verified |\n| --- | --- | --- | --- | --- |\n| S-1 | VAT is 21% | https://tax.example.test | 2026-08-31 | yes |\n| S-2 | Rates | https://tax.example.test | 2026-09-01 | yes |\n',
    );
    const result = runDrift(workspace, { now: () => NOW });
    expect(result.ok).toBe(false);
    expect(result.lines).toEqual([
      'S-1 "VAT is 21%" (https://tax.example.test) was verified 61 days ago, older than 60. Re-verify it.',
    ]);
    expect(workspace.read('drift.md')).toContain('gate: failed');
  });
});
