import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import { findPython } from '../../../scripts/build-discovery.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PLUGIN = join(repoRoot, 'plugins', 'discovery');
const MODULES = ['test_tracker_grounding', 'test_posting', 'test_tickets', 'test_record'];

const RUNNER = [
  'import json, sys, unittest',
  'sys.path.insert(0, sys.argv[1])',
  'suite = unittest.defaultTestLoader.loadTestsFromNames(sys.argv[2:])',
  'result = unittest.TestResult()',
  'def flat(s):',
  '    for t in s:',
  '        if isinstance(t, unittest.TestSuite):',
  '            yield from flat(t)',
  '        else:',
  '            yield t',
  'ran = [test.id() for test in flat(suite)]',
  'suite.run(result)',
  'bad = [t.id() for t, _ in result.failures + result.errors] + [t.id() for t, _ in result.skipped]',
  'sys.stdout.write("\\n" + json.dumps({"ran": ran, "bad": bad}))',
].join('\n');

let ran: string[] = [];
let bad: string[] = [];

beforeAll(() => {
  const python = findPython().command;
  const run = spawnSync(python, ['-c', RUNNER, join(PLUGIN, 'tests', 'scripts'), ...MODULES], {
    cwd: PLUGIN,
    encoding: 'utf8',
    timeout: 300_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  expect(run.status, run.stderr).toBe(0);
  const last = run.stdout.trim().split('\n').at(-1) ?? '{}';
  const parsed = JSON.parse(last) as { ran: string[]; bad: string[] };
  ran = parsed.ran;
  bad = parsed.bad;
}, 300_000);

function expectProven(n: number): void {
  const names = new RegExp(`\\.test_(?:ac_\\d+_and_)?ac_${n}_`);
  const proving = ran.filter((id) => names.test(id));
  expect(proving.length, `no plugin test names criterion ${n}`).toBeGreaterThan(0);
  expect(proving.filter((id) => bad.includes(id))).toEqual([]);
}

describe('discovery plugin tests that prove the tracker grounding and existing epic criteria', () => {
  it('AC-1: the skill text tells a tracker-only run to carry on with its own source line', () =>
    expectProven(1));
  it('AC-2: the skill text tells the journey to read the repository first and tickets second', () =>
    expectProven(2));
  it('AC-3: the skill text tells a line that rests on tickets to keep the label and keys', () =>
    expectProven(3));
  it('AC-9: the skill text tells a readable, not writable tracker to ground and leave by export', () =>
    expectProven(9));
  it('AC-10: the skill text keeps a repository-only run on the same steps as before', () =>
    expectProven(10));
  it('AC-11: a record without grounding sources is repository only', () => expectProven(11));
  it('AC-12: the skill text tells a resumed tracker-only run to say the notice once and ask late', () =>
    expectProven(12));
  it('AC-13: the skill text tells a repository connected mid run to redo step 2 onward', () =>
    expectProven(13));
  it('AC-16: the skill text tells either search kind to keep epics first inside one cap', () =>
    expectProven(16));
  it('AC-17: the skill text tells later steps to reuse what was read once the total is used', () =>
    expectProven(17));
  it('AC-18: the skill text says nothing related carries on and never means not built', () =>
    expectProven(18));
  it('AC-19: the skill text tells the journey to ask the epic question once and record it', () =>
    expectProven(19));
  it('AC-20: the skill text tells the journey to skip the question with one line when no epic matches', () =>
    expectProven(20));
  it('AC-21: the skill text tells the journey to check a typed key and record nothing until it passes', () =>
    expectProven(21));
  it('AC-22: the skill text tells the journey to draft a new epic when the tracker is unreadable', () =>
    expectProven(22));
  it('AC-23: a redraft cannot drop or change the chosen epic', () => expectProven(23));
  it('AC-24: a new epic choice stales the ticket set, readiness and posted', () =>
    expectProven(24));
  it('AC-25: the skill text gives one choice per epic and lets a single group be moved', () =>
    expectProven(25));
  it('AC-26: the skill text tells a resumed run with an unreadable tracker to leave by export', () =>
    expectProven(26));
  it('AC-27: the structure check refuses a bad existing epic entry', () => expectProven(27));
  it('AC-28: the skill text tells a ticket under an existing epic to stand on its own', () =>
    expectProven(28));
  it('AC-29: verify comes first and the existing epic is never created', () => expectProven(29));
  it('AC-31: a done epic is asked about first and a no creates nothing', () => expectProven(31));
  it('AC-33: the read-back expects the new epic and never counts the existing one', () =>
    expectProven(33));
  it('AC-37: the skill text tells a glossary pair to note that the term came from the tickets', () =>
    expectProven(37));
  it('AC-38: the skill text tells the first use of a term to show the other term in brackets', () =>
    expectProven(38));
  it('AC-41: the skill text tells ticket text to follow the language of the existing tickets', () =>
    expectProven(41));
  it('AC-42: the skill text keeps checked record values as defined in another language', () =>
    expectProven(42));
});
