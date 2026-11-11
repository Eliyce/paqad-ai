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
  it('AC-1: a tracker-only run carries on with its own source line', () => expectProven(1));
  it('AC-2: the repository is read first and ticket lines come second', () => expectProven(2));
  it('AC-3: a line that rests on tickets keeps the label and the keys', () => expectProven(3));
  it('AC-9: a readable but not writable tracker grounds and leaves by export', () =>
    expectProven(9));
  it('AC-10: a repository-only run walks the same steps as before', () => expectProven(10));
  it('AC-11: a record without grounding sources is repository only', () => expectProven(11));
  it('AC-12: a resumed tracker-only run says the notice once and asks to reconnect late', () =>
    expectProven(12));
  it('AC-13: a repository connected mid run redoes step 2 onward', () => expectProven(13));
  it('AC-16: either search kind keeps epics first inside one cap', () => expectProven(16));
  it('AC-17: later steps reuse what was read once the total is used', () => expectProven(17));
  it('AC-18: nothing related carries on and never means not built', () => expectProven(18));
  it('AC-19: the epic question is asked once and recorded as the epic choice', () =>
    expectProven(19));
  it('AC-20: no matching epic skips the question with one line', () => expectProven(20));
  it('AC-21: a typed key is checked and nothing is recorded until it passes', () =>
    expectProven(21));
  it('AC-22: an unreadable tracker drafts a new epic', () => expectProven(22));
  it('AC-23: a redraft cannot drop or change the chosen epic', () => expectProven(23));
  it('AC-24: a new epic choice stales the ticket set, readiness and posted', () =>
    expectProven(24));
  it('AC-25: one choice per epic and a single group can be moved', () => expectProven(25));
  it('AC-26: a resumed run with an unreadable tracker leaves by export', () => expectProven(26));
  it('AC-27: the structure check refuses a bad existing epic entry', () => expectProven(27));
  it('AC-28: a ticket under an existing epic stands on its own', () => expectProven(28));
  it('AC-29: verify comes first and the existing epic is never created', () => expectProven(29));
  it('AC-31: a done epic is asked about first and a no creates nothing', () => expectProven(31));
  it('AC-33: the read-back expects the new epic and never counts the existing one', () =>
    expectProven(33));
  it('AC-37: a glossary pair notes that the other term came from the tickets', () =>
    expectProven(37));
  it('AC-38: the first use of a term shows the other term in brackets', () => expectProven(38));
  it('AC-41: ticket text follows the language of the existing tickets', () => expectProven(41));
  it('AC-42: checked record values stay as defined in another language', () => expectProven(42));
});
