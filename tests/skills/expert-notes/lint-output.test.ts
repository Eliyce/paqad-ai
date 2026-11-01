import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runScript } from '../../unit/skills/_helpers/run-script.js';

const SKILL = process.env.PAQAD_SKILL_UNDER_TEST ?? 'runtime/base/skills/expert-notes';
const SCRIPT = join(SKILL, 'scripts', 'lint-output.sh');
const OUTPUT_LIMIT_BYTES = 40_000;
const CANARY = 'canary-value-from-a-claim-7f3a';

function note(role: string, findings: number): object {
  return {
    role,
    findings: Array.from({ length: findings }, (_, index) => ({
      target: `invoices table ${index}`,
      claim: 'customer_id needs an index before the import runs',
      kind: 'requirement',
      severity: 'must',
    })),
    questions: [],
    ...(role === 'qa-engineer'
      ? {
          verdicts: {
            spec_compliance: { status: 'pass', reason: 'the spec does what the request asks' },
            quality: { status: 'concerns', reason: 'the empty case has no criterion' },
          },
        }
      : {}),
  };
}

const VALID = JSON.stringify({ notes: [note('db-expert', 2)], tokens: { 'db-expert': 900 } });

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'expert-notes-lint-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function snapshot(folder: string): string {
  return readdirSync(folder)
    .sort()
    .map((name) => {
      const path = join(folder, name);
      return `${name}:${statSync(path).mtimeMs}:${readFileSync(path, 'utf8')}`;
    })
    .join('\n');
}

describe('expert-notes lint-output.sh contract', () => {
  it('lint-output help', () => {
    const result = runScript(SCRIPT, ['--help']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Usage:');
    expect(result.stdout).toContain('<file>');
    expect(result.stdout).toContain('stdin');
    expect(runScript(SCRIPT, ['-h']).status).toBe(0);
  });

  it('lint-output invalid input', () => {
    const missing = runScript(SCRIPT, [join(dir, 'absent.json')]);
    expect(missing.status).toBe(2);
    expect(missing.stderr).toContain('file not found');
    const notJson = runScript(SCRIPT, [], { input: '{not json' });
    expect(notJson.status).toBe(1);
    expect(notJson.stderr).toContain('not valid JSON');
    const noNotes = runScript(SCRIPT, [], { input: JSON.stringify({ tokens: {} }) });
    expect(noNotes.status).toBe(1);
    expect(noNotes.stderr).toContain('notes[] array');
  });

  it('lint-output fixture output', () => {
    const file = join(dir, 'notes.json');
    writeFileSync(file, VALID);
    const clean = runScript(SCRIPT, [file]);
    expect(clean.status).toBe(0);
    expect(clean.stdout.trim()).toBe('ok');
    const bad = JSON.stringify({
      notes: [{ role: 'db-expert', findings: [{ claim: 'c', kind: 'wish', severity: 'maybe' }] }],
    });
    const result = runScript(SCRIPT, [], { input: bad });
    expect(result.status).toBe(1);
    expect(result.stderr.trim().split('\n')).toEqual([
      'notes[0].findings[0] needs a target',
      'notes[0].findings[0] unknown kind "wish"',
      'notes[0].findings[0] unknown severity "maybe"',
    ]);
  });

  it('AC-19: lint-output needs both QA verdicts on the qa-engineer note and none on other roles', () => {
    const qa = { role: 'qa-engineer', findings: [] };
    const missing = runScript(SCRIPT, [], { input: JSON.stringify({ notes: [qa] }) });
    expect(missing.status).toBe(1);
    expect(missing.stderr.trim().split('\n')).toEqual([
      'notes[0].verdicts.spec_compliance needs a status of pass, concerns or fail',
      'notes[0].verdicts.quality needs a status of pass, concerns or fail',
    ]);
    const noReason = runScript(SCRIPT, [], {
      input: JSON.stringify({
        notes: [
          {
            ...qa,
            verdicts: {
              spec_compliance: { status: 'pass', reason: 'ok' },
              quality: { status: 'fail', reason: ' ' },
            },
          },
        ],
      }),
    });
    expect(noReason.stderr.trim()).toBe('notes[0].verdicts.quality needs a reason');
    const other = runScript(SCRIPT, [], {
      input: JSON.stringify({
        notes: [{ role: 'db-expert', findings: [], verdicts: {} }],
      }),
    });
    expect(other.stderr.trim()).toBe(
      'notes[0] ("db-expert") may not carry verdicts; only qa-engineer gives them',
    );
    expect(
      runScript(SCRIPT, [], { input: JSON.stringify({ notes: [note('qa-engineer', 0)] }) }).status,
    ).toBe(0);
  });

  it('lint-output idempotency', () => {
    const first = runScript(SCRIPT, [], { input: VALID });
    const second = runScript(SCRIPT, [], { input: VALID });
    expect(second).toEqual(first);
  });

  it('lint-output dry run', () => {
    const file = join(dir, 'notes.json');
    writeFileSync(file, VALID);
    const before = snapshot(dir);
    expect(runScript(SCRIPT, [file]).status).toBe(0);
    expect(runScript(SCRIPT, [], { input: '{not json', cwd: dir }).status).toBe(1);
    expect(snapshot(dir)).toBe(before);
  });

  it('lint-output output size', () => {
    const roles = ['db-expert', 'security-auditor', 'qa-engineer', 'product-owner'];
    const large = JSON.stringify({ notes: roles.map((role) => note(role, 50)), tokens: {} });
    const clean = runScript(SCRIPT, [], { input: large });
    expect(clean.status).toBe(0);
    expect(clean.stdout.length).toBeLessThan(OUTPUT_LIMIT_BYTES);
    const broken = JSON.stringify({
      notes: roles.map((role) => ({ role, findings: Array.from({ length: 50 }, () => ({})) })),
    });
    const failed = runScript(SCRIPT, [], { input: broken });
    expect(failed.status).toBe(1);
    expect(failed.stdout.length + failed.stderr.length).toBeLessThan(OUTPUT_LIMIT_BYTES);
  });

  it('lint-output secrets', () => {
    const leaky = JSON.stringify({
      notes: [
        {
          role: 'security-auditor',
          findings: [{ target: 'payments', claim: `rotate ${CANARY}` }, { claim: CANARY }],
        },
      ],
    });
    const result = runScript(SCRIPT, [], { input: leaky });
    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain(CANARY);
    expect(result.stderr).not.toContain(CANARY);
  });
});
