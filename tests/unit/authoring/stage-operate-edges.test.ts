import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { appendGotcha, resolveLearn, runDrift, runLearn } from '@/authoring/stages/operate.js';
import { askForOverride, hasSecretFinding, recordOverride } from '@/authoring/stages/override.js';
import { runEvidence } from '@/authoring/stages/sources.js';
import { renderGateMarkdown, SkillWorkspace } from '@/authoring/workspace.js';
import { resolvePendingDecision } from '@/decisions/authoring.js';

const NAME = 'booking-invoices';
const SKILL = `---\nname: ${NAME}\ndescription: Books invoices. Use when one arrives.\n---\n# Booking\n\n1. Book it.\n\n## Gotchas\n\nOne known trap.\n`;
const SOURCES =
  '| S-ID | Fact | Origin | Date | Verified |\n| --- | --- | --- | --- | --- |\n| S-1 | Rates | app/Rates.php:3 | 2026-10-31 | yes |\n';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-skill-operate-edges-'));
  mkdirSync(join(root, '.paqad'), { recursive: true });
  mkdirSync(join(root, 'home'));
  vi.stubEnv('HOME', join(root, 'home'));
  vi.stubEnv('USERPROFILE', join(root, 'home'));
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

function atS2(): SkillWorkspace {
  const workspace = new SkillWorkspace(root, 'csv-dedupe');
  workspace.write('justification.md', renderGateMarkdown({ gate: 'passed' }, 'x'));
  workspace.write(
    'intake.yaml',
    'purpose: "Removes duplicate rows from finance CSV exports by a key column"\ntriggers: ["dedupe the export"]\noutput_format: csv\nverifiability: objective\nskill_class: technique\nscope: { in: ["exports"], out: ["imports"] }\ndependencies: ["none"]\n',
  );
  return workspace;
}

describe('learn edges', () => {
  beforeEach(() => write(`.claude/skills/${NAME}/SKILL.md`, SKILL));

  it('refuses an empty correction or scope', () => {
    expect(() =>
      runLearn(new SkillWorkspace(root, NAME), { correction: ' ', scope: 'here', source: 'S-1' }),
    ).toThrow('learn needs a correction and --scope');
  });

  it('refuses a decision that is not the pending one, or not answered yet', () => {
    const workspace = new SkillWorkspace(root, NAME);
    const asked = runLearn(workspace, { correction: 'x', scope: 'here', source: 'S-1' });
    expect(() => resolveLearn(workspace, { decision: 'D-01M6000000000000000000000X' })).toThrow(
      'There is no pending correction',
    );
    expect(() => resolveLearn(workspace, { decision: asked.decision! })).toThrow(
      'is not answered yet',
    );
  });

  it('keeps an existing draft and stamps today when no clock is given', () => {
    const workspace = new SkillWorkspace(root, NAME);
    workspace.write(`draft/${NAME}/SKILL.md`, SKILL);
    const asked = runLearn(workspace, {
      correction: 'Totals carry VAT.',
      scope: 'here',
      source: 'S-2',
    });
    resolvePendingDecision(root, asked.decision!, 'improve', 'yes');
    resolveLearn(workspace, { decision: asked.decision! });
    expect(workspace.read(`draft/${NAME}/SKILL.md`)).toContain('(S-2): Totals carry VAT.');
  });

  it('adds a blank line after a Gotchas heading with no entries', () => {
    const text = appendGotcha('# Skill\n\n## Gotchas\n## Next\n', '- learned x');
    expect(text).toBe('# Skill\n\n## Gotchas\n\n- learned x\n## Next\n');
  });
});

describe('drift', () => {
  it('reports every fact fresh when none is old, with the real clock', () => {
    const workspace = new SkillWorkspace(root, NAME);
    workspace.write(
      'sources.md',
      SOURCES.replace('2026-10-31', new Date().toISOString().slice(0, 10)),
    );
    const result = runDrift(workspace);
    expect(result.ok).toBe(true);
    expect(result.lines).toEqual([`${NAME}: every externally verified fact is fresh.`]);
  });

  it('reports nothing to judge when sources.md is missing', () => {
    expect(runDrift(new SkillWorkspace(root, NAME)).ok).toBe(true);
  });
});

describe('S2 evidence edges', () => {
  it('refuses an empty table, a bad sources kind and a missing intake', () => {
    const workspace = atS2();
    expect(() => runEvidence(workspace, { sourcesText: 'no table', userHome: null })).toThrow(
      'sources.md has no rows',
    );
    expect(() =>
      runEvidence(workspace, { sourcesText: SOURCES, sourcesKind: 'web', userHome: null }),
    ).toThrow('--sources-kind only accepts no-repo.');
    workspace.remove('intake.yaml');
    workspace.write('intake.yaml', '');
    expect(() => runEvidence(workspace, { sourcesText: SOURCES, userHome: null })).toThrow();
  });

  it('records a no-repo source kind and fills short rows', () => {
    const workspace = atS2();
    const result = runEvidence(workspace, {
      sourcesText: `${SOURCES}| S-2 | Short row | https://x.test |\n`,
      sourcesKind: 'no-repo',
      userHome: null,
      installed: [],
    });
    expect(result.ok).toBe(true);
    expect(workspace.read('overlap.md')).toContain('sources_kind: no-repo');
  });

  it('refuses a decision that is not an overlap decision or not answered', () => {
    const workspace = atS2();
    const ask = askForOverride(new SkillWorkspace(root, NAME), { gate: 'S5', why: 'x' });
    expect(() =>
      runEvidence(workspace, {
        sourcesText: SOURCES,
        decision: ask.decision!,
        userHome: null,
        installed: [],
      }),
    ).toThrow('is not an authoring.overlap decision.');
  });

  it('warns when the catalog description budget is exceeded', () => {
    const workspace = atS2();
    writeFileSync(join(root, '.paqad/.config'), 'authoring_description_budget_chars=10\n');
    write(`.claude/skills/${NAME}/SKILL.md`, SKILL);
    const result = runEvidence(workspace, { sourcesText: SOURCES, userHome: null });
    expect(result.lines.join('\n')).toContain('over the budget of 10');
  });
});

describe('override edges', () => {
  it('refuses a decision of another category, one the owner declined, and keeps a default reason', () => {
    const workspace = new SkillWorkspace(root, NAME);
    expect(hasSecretFinding(workspace)).toBe(false);
    write(`.claude/skills/${NAME}/SKILL.md`, SKILL);
    const learn = runLearn(workspace, { correction: 'x', scope: 'here', source: 'S-1' });
    expect(() => recordOverride(workspace, { gate: 'S5', decision: learn.decision! })).toThrow(
      'is a authoring.improvement decision, not authoring.override.',
    );
    const declined = askForOverride(workspace, { gate: 'S5', why: 'slow' });
    resolvePendingDecision(root, declined.decision!, 'do-not-add', 'no');
    expect(() => recordOverride(workspace, { gate: 'S5', decision: declined.decision! })).toThrow(
      'The owner chose not to add',
    );
    const granted = askForOverride(workspace, { gate: 'S6', why: 'slow' });
    resolvePendingDecision(root, granted.decision!, 'add-unverified', '');
    const recorded = recordOverride(workspace, { gate: 'S6', decision: granted.decision! });
    expect(workspace.readJson<Array<{ reason: string }>>('overrides.json')![0]!.reason).toBe(
      `decision ${granted.decision}`,
    );
    expect(recorded.ok).toBe(true);
  });
});
