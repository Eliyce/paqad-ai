import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSkillCommand } from '@/cli/commands/skill.js';
import { readContractDecisions, resolvePendingDecision } from '@/decisions/authoring.js';

const NAME = 'processing-invoices';
const WS = `.paqad/tmp/authoring/skills/${NAME}`;

const INTAKE = [
  'purpose: "Parse supplier invoices into the ledger format"',
  'triggers: ["an invoice pdf arrives", "book a supplier invoice"]',
  'output_format: "ledger JSON"',
  'verifiability: objective',
  'skill_class: workflow',
  'scope: { in: ["supplier invoices"], out: ["credit notes"] }',
  'dependencies: ["none"]',
  '',
].join('\n');

const SOURCES = [
  '| S-ID | Fact | Origin | Date | Verified |',
  '| --- | --- | --- | --- | --- |',
  '| S-1 | Invoices are soft-deleted | app/Models/Invoice.php:41 | 2026-10-31 | yes |',
  '| S-2 | Totals include VAT | model | 2026-10-31 | no |',
  '',
].join('\n');

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

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-skill-verbs-'));
  mkdirSync(join(root, '.paqad'), { recursive: true });
  vi.stubEnv('PAQAD_SKILL_ORCHESTRATOR_ENABLED', undefined);
  mkdirSync(join(root, 'home'), { recursive: true });
  vi.stubEnv('HOME', join(root, 'home'));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  process.exitCode = undefined;
  rmSync(root, { recursive: true, force: true });
});

function write(rel: string, content: string): string {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
  return abs;
}

function read(rel: string): string {
  return readFileSync(join(root, rel), 'utf8');
}

async function run(...args: string[]): Promise<{ out: string; err: string; code: number }> {
  const out: string[] = [];
  const err: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((line: string) => {
    out.push(String(line));
  });
  vi.spyOn(console, 'error').mockImplementation((line: string) => {
    err.push(String(line));
  });
  process.exitCode = undefined;
  await createSkillCommand().parseAsync([...args, '--project-root', root], { from: 'user' });
  const code = Number(process.exitCode ?? 0);
  vi.restoreAllMocks();
  return { out: out.join('\n'), err: err.join('\n'), code };
}

function baseline(passed: [boolean, boolean, boolean]): void {
  passed.forEach((_, index) => write(`${WS}/baseline/run-${index + 1}.md`, `run ${index + 1}\n`));
  write(
    `${WS}/baseline/verdicts.json`,
    JSON.stringify(
      passed.map((ok, index) => ({ run: index + 1, passed: ok, note: ok ? 'ok' : 'wrong total' })),
    ),
  );
}

async function throughIntake(): Promise<void> {
  baseline([true, false, true]);
  expect((await run('justify', NAME)).code).toBe(0);
  expect((await run('intake', NAME, write('intake.yaml', INTAKE))).code).toBe(0);
}

async function throughEvidence(): Promise<void> {
  await throughIntake();
  expect((await run('evidence', NAME, write('sources.md', SOURCES))).code).toBe(0);
}

describe('S0 justify', () => {
  it('passes when at least one baseline run failed', async () => {
    baseline([true, false, true]);
    const result = await run('justify', NAME);
    expect(result.out).toContain('A skill is justified: the agent got it wrong 1 time out of 3');
    expect(read(`${WS}/justification.md`)).toMatch(/^---\ngate: passed\n/);
  });

  it('FR-13: stops with the exact line when all three runs passed', async () => {
    baseline([true, true, true]);
    const result = await run('justify', NAME);
    expect(result.out).toBe(
      'No skill needed: the agent did this right 3 times out of 3 without one. I stopped here.',
    );
    expect(result.code).toBe(0);
    expect((await run('status', NAME)).out).toContain('The pipeline stopped at S0');
  });

  it.each([
    ['one-off', [], "This is a one-off fix, so it doesn't need a skill. Fix it in this change."],
    [
      'documented',
      ['--documented-in', 'docs/runbooks/invoices.md'],
      'This is already documented in docs/runbooks/invoices.md. Point the agent there instead of adding a skill.',
    ],
    [
      'convention',
      [],
      'This is a project convention. It belongs in the always-loaded instructions file, not a skill.',
    ],
  ])('stops for the %s exclusion with its line', async (kind, extra, line) => {
    const result = await run('justify', NAME, '--exclusion', kind, ...extra);
    expect(result.out.split('\n')[0]).toBe(line);
    expect(result.out).toContain('No skill folder was created.');
  });

  it('AC-22: a never-break rule ends as a proposal naming the hook, with no skill folder', async () => {
    const result = await run(
      'justify',
      NAME,
      '--exclusion',
      'enforceable',
      '--enforce-with',
      'a pre-commit hook',
    );
    expect(result.out).toContain(
      "A script or hook can enforce this. I'll propose a rules-as-scripts check instead of a skill.",
    );
    expect(result.out).toContain(
      'Proposal: enforce this with a pre-commit hook instead of a skill.',
    );
    expect(existsSync(join(root, '.claude/skills', NAME))).toBe(false);
    expect(existsSync(join(root, WS, 'draft'))).toBe(false);
    expect((await run('intake', NAME, write('intake.yaml', INTAKE))).code).toBe(1);
  });

  it('AC-37: refuses a missing or malformed verdicts.json and writes no artifact', async () => {
    const missing = await run('justify', NAME);
    expect(missing.code).toBe(1);
    expect(missing.err).toContain(`${WS}/baseline/verdicts.json is missing`);
    expect(missing.err).toContain(`paqad-ai skill justify ${NAME}`);
    write(`${WS}/baseline/verdicts.json`, '[{"run":1,"passed":true}]');
    expect((await run('justify', NAME)).err).toContain('needs exactly 3 entries');
    write(
      `${WS}/baseline/verdicts.json`,
      JSON.stringify([
        { run: 1, passed: true, note: 'a' },
        { run: 2, passed: 'yes', note: 'b' },
        { run: 3, passed: true },
      ]),
    );
    expect((await run('justify', NAME)).err).toContain('entry 2 is missing passed');
    write(`${WS}/baseline/verdicts.json`, '{bad');
    expect((await run('justify', NAME)).err).toContain('is not valid JSON');
    expect(existsSync(join(root, WS, 'justification.md'))).toBe(false);
  });

  it('AC-59: refuses an unsafe name with a usage exit before touching disk', async () => {
    const result = await run('justify', '../x');
    expect(result.code).toBe(2);
    expect(existsSync(join(root, '.paqad/tmp'))).toBe(false);
  });

  it('EC-19: does nothing while the orchestrator is off', async () => {
    write('.paqad/.config', 'skill_orchestrator_enabled=false\n');
    baseline([false, false, false]);
    const result = await run('justify', NAME);
    expect(result.out).toContain('The Skill Orchestrator is off');
    expect(existsSync(join(root, WS, 'justification.md'))).toBe(false);
  });
});

describe('S1 intake', () => {
  it('AC-1: refuses before S0 passed, naming justification.md and paqad-ai skill justify', async () => {
    const result = await run('intake', NAME, write('intake.yaml', INTAKE));
    expect(result.code).toBe(1);
    expect(result.err).toContain(`${WS}/justification.md`);
    expect(result.err).toContain(`Run paqad-ai skill justify ${NAME} first`);
  });

  it('AC-17: names exactly the empty fields', async () => {
    baseline([false, true, true]);
    await run('justify', NAME);
    const partial =
      'purpose: "x"\ntriggers: []\noutput_format: ""\nverifiability: objective\nskill_class: workflow\n';
    const result = await run('intake', NAME, write('intake.yaml', partial));
    expect(result.code).toBe(1);
    expect(result.err).toContain(
      'these fields are empty: triggers, output_format, scope, dependencies.',
    );
    expect(existsSync(join(root, WS, 'intake.yaml'))).toBe(false);
  });

  it('refuses an unknown skill_class', async () => {
    baseline([false, true, true]);
    await run('justify', NAME);
    const result = await run(
      'intake',
      NAME,
      write('intake.yaml', INTAKE.replace('workflow', 'misc')),
    );
    expect(result.err).toContain('skill_class must be one of');
  });

  it('FR-51: an intake gap raises authoring.intake_gap and status waits on it', async () => {
    baseline([false, true, true]);
    await run('justify', NAME);
    const gap = await run(
      'intake',
      NAME,
      '--gap',
      'scope',
      '--question',
      'Should credit notes be in scope?',
      '--option',
      'Only invoices',
      '--option',
      'Invoices and credit notes',
      '--recommend',
      'Only invoices',
    );
    expect(gap.code).toBe(0);
    const packets = readContractDecisions(root).filter(
      (row) => row.packet.category === 'authoring.intake_gap',
    );
    expect(packets).toHaveLength(1);
    expect(packets[0]!.packet.recommendation).toBe('option-1');
    const id = packets[0]!.packet.id;
    expect((await run('status', NAME)).out).toContain(`S1 intake: waiting on decision ${id}`);
    resolvePendingDecision(root, id, 'option-1', 'owner');
    expect((await run('status', NAME)).out).toContain(`decision ${id} is answered`);
    await run('intake', NAME, write('intake.yaml', INTAKE));
    expect((await run('status', NAME)).out).toContain('S1 intake: passed');
  });
});

describe('S2 evidence', () => {
  it('passes with one non-model source and writes sources.md and overlap.md', async () => {
    await throughIntake();
    const result = await run('evidence', NAME, write('sources.md', SOURCES));
    expect(result.out).toContain('S2 evidence passed: 1 of 2 sources come from outside the model');
    expect(read(`${WS}/overlap.md`)).toContain('gate: passed');
    expect(read(`${WS}/sources.md`)).toBe(SOURCES);
  });

  it('refuses when every source is the model', async () => {
    await throughIntake();
    const onlyModel = SOURCES.replace('app/Models/Invoice.php:41', 'model');
    const result = await run('evidence', NAME, write('sources.md', onlyModel));
    expect(result.code).toBe(1);
    expect(result.err).toContain('every source has origin "model"');
  });

  function installRival(): void {
    write(
      '.claude/skills/booking-invoices/SKILL.md',
      '---\nname: booking-invoices\ndescription: Parse supplier invoices into the ledger format. Use when a supplier invoice pdf arrives.\n---\n',
    );
  }

  it('AC-13: a collision raises authoring.overlap and Create a new skill lets S2 pass', async () => {
    installRival();
    await throughIntake();
    const first = await run('evidence', NAME, write('sources.md', SOURCES));
    expect(first.code).toBe(0);
    expect(first.out).toContain(`${NAME} collides with booking-invoices`);
    const packet = readContractDecisions(root).find(
      (row) => row.packet.category === 'authoring.overlap',
    )!.packet;
    expect(packet.recommendation).toBe('extend');
    expect(packet.options.map((entry) => entry.label)).toEqual([
      'Extend booking-invoices',
      'Create a new skill',
    ]);
    expect(read(`${WS}/overlap.md`)).toContain('collides with booking-invoices');
    expect((await run('draft', NAME, '--dir', root, '--trace', write('t.md', ''))).err).toContain(
      `waiting on decision ${packet.id}`,
    );
    resolvePendingDecision(root, packet.id, 'create-new', 'owner');
    const second = await run(
      'evidence',
      NAME,
      write('sources.md', SOURCES),
      '--decision',
      packet.id,
    );
    expect(second.out).toContain('S2 evidence passed');
  });

  it('AC-61: Extend clears the new workspace and points at improve on the installed skill', async () => {
    installRival();
    await throughIntake();
    await run('evidence', NAME, write('sources.md', SOURCES));
    const id = readContractDecisions(root).find(
      (row) => row.packet.category === 'authoring.overlap',
    )!.packet.id;
    resolvePendingDecision(root, id, 'extend', 'owner');
    const result = await run('evidence', NAME, write('sources.md', SOURCES), '--decision', id);
    expect(result.out).toContain('paqad-ai skill improve booking-invoices');
    expect(existsSync(join(root, WS))).toBe(false);
  });

  it('EC-06: a user skill with the same name shadows the new one and fails the gate', async () => {
    await throughIntake();
    const home = mkdtempSync(join(tmpdir(), 'paqad-skill-home-'));
    vi.stubEnv('HOME', home);
    mkdirSync(join(home, `.claude/skills/${NAME}`), { recursive: true });
    writeFileSync(
      join(home, `.claude/skills/${NAME}/SKILL.md`),
      `---\nname: ${NAME}\ndescription: other\n---\n`,
    );
    const result = await run('evidence', NAME, write('sources.md', SOURCES));
    rmSync(home, { recursive: true, force: true });
    expect(result.code).toBe(1);
    expect(result.out).toContain('would shadow the new project one. Pick another name.');
  });
});

describe('S3 draft', () => {
  const TRACE_OK = [
    '| Block | Lines | S-IDs |',
    '| --- | --- | --- |',
    '| Processing invoices | 5-7 | S-1 |',
    '',
    '## Unsourced',
    '',
    '- Gotchas (lines 9-11): model-knowledge: common soft-delete behaviour',
    '',
  ].join('\n');

  it('AC-5: lists an unmapped block under ## Unsourced and fails until it has a reason', async () => {
    await throughEvidence();
    const dir = dirname(write(`drafts/${NAME}/SKILL.md`, SKILL));
    const partial =
      '| Block | Lines | S-IDs |\n| --- | --- | --- |\n| Processing invoices | 5-7 | S-1 |\n';
    const failed = await run('draft', NAME, '--dir', dir, '--trace', write('trace.md', partial));
    expect(failed.code).toBe(1);
    expect(failed.out).toContain('unsourced blocks without a reason: Gotchas');
    const trace = read(`${WS}/trace.md`);
    expect(trace).toContain('## Unsourced');
    expect(trace).toContain('- Gotchas (lines 9-11): needs a reason');
    expect((await run('status', NAME)).out).toContain('S3 draft: failed');

    const passed = await run('draft', NAME, '--dir', dir, '--trace', write('trace.md', TRACE_OK));
    expect(passed.code).toBe(0);
    expect(passed.out).toContain('S3 draft passed: all 2 instruction blocks are traced.');
    expect(read(`${WS}/draft/${NAME}/SKILL.md`)).toBe(SKILL);
  });

  it('fails on an S-ID that sources.md does not hold', async () => {
    await throughEvidence();
    const dir = dirname(write(`drafts/${NAME}/SKILL.md`, SKILL));
    const result = await run(
      'draft',
      NAME,
      '--dir',
      dir,
      '--trace',
      write('trace.md', TRACE_OK.replace('S-1 |', 'S-9 |')),
    );
    expect(result.out).toContain('S-IDs not in sources.md: S-9');
  });

  it('INV-7: refuses a symlink inside the drafted folder', async () => {
    await throughEvidence();
    const dir = dirname(write(`drafts/${NAME}/SKILL.md`, SKILL));
    symlinkSync(join(root, 'intake.yaml'), join(dir, 'linked.md'));
    const result = await run('draft', NAME, '--dir', dir, '--trace', write('trace.md', TRACE_OK));
    expect(result.err).toContain('linked.md is a symlink');
  });

  it('FR-18: a refused draft becomes a defect with the receipt line, never a question', async () => {
    await throughEvidence();
    const result = await run(
      'draft',
      NAME,
      '--refuse',
      'the instructions send invoices to a third party',
    );
    expect(result.code).toBe(1);
    expect(result.out).toContain(`I couldn't get the skill ${NAME} through its S3 check`);
    expect(read('.paqad/ledger/authoring/defects.jsonl')).toContain('"gate":"S3"');
    expect(readContractDecisions(root)).toEqual([]);
  });
});

describe('status, reruns and improve', () => {
  it('AC-12: status rebuilds every gate from the workspace files alone', async () => {
    await throughEvidence();
    const status = (await run('status', NAME)).out.split('\n');
    expect(status).toEqual([
      `Entry: paqad-ai skill justify ${NAME} (a new skill).`,
      `S0 justify: passed (${WS}/justification.md)`,
      `S1 intake: passed (${WS}/intake.yaml)`,
      `S2 evidence: passed (${WS}/overlap.md)`,
      `S3 draft: not run yet (${WS}/trace.md)`,
      `S4 lint and tests: not run yet (${WS}/script-tests.json)`,
      `S5 evals: not run yet (${WS}/benchmark.json)`,
      `S6 trigger: not run yet (${WS}/trigger-results.json)`,
      `S7 release: not run yet (${WS}/release.json)`,
      `Next: S3 draft, run paqad-ai skill draft ${NAME} --dir <folder> --trace <trace.md>.`,
    ]);
  });

  it('AC-38: a rerun changes only its own artifact', async () => {
    await throughEvidence();
    const before = [read(`${WS}/justification.md`), read(`${WS}/overlap.md`)];
    await run('intake', NAME, write('intake.yaml', INTAKE.replace('ledger JSON', 'ledger rows')));
    expect([read(`${WS}/justification.md`), read(`${WS}/overlap.md`)]).toEqual(before);
    expect(read(`${WS}/intake.yaml`)).toContain('ledger rows');
  });

  it('AC-62: an installed skill names improve as the entry', async () => {
    write(`.claude/skills/${NAME}/SKILL.md`, SKILL);
    const status = await run('status', NAME);
    expect(status.out).toContain(
      `Entry: paqad-ai skill improve ${NAME} (the skill is already installed at .claude/skills/${NAME}).`,
    );
    expect(status.code).toBe(0);
  });

  it('AC-21, FR-52: improve snapshots before any edit and skips S0, then S1 once intake exists', async () => {
    write(`.claude/skills/${NAME}/SKILL.md`, SKILL);
    write(`.claude/skills/${NAME}/references/guide.md`, 'guide\n');
    const result = await run('improve', NAME);
    expect(result.out).toContain(`Snapshotted 2 files of .claude/skills/${NAME}`);
    expect(read(`${WS}/skill-snapshot/SKILL.md`)).toBe(SKILL);
    write(`.claude/skills/${NAME}/SKILL.md`, `${SKILL}\nedited\n`);
    expect((await run('improve', NAME)).out).toContain('already exists; I kept it as the baseline');
    expect(read(`${WS}/skill-snapshot/SKILL.md`)).toBe(SKILL);

    const intake = await run('intake', NAME, write('intake.yaml', INTAKE));
    expect(intake.code).toBe(0);
    const status = (await run('status', NAME)).out;
    expect(status).toContain('S0 justify: skipped');
    expect(status).toContain('S1 intake: passed');
  });

  it('refuses improve for a skill that is not installed', async () => {
    const result = await run('improve', NAME);
    expect(result.err).toContain(`start with paqad-ai skill justify ${NAME}`);
  });
});
