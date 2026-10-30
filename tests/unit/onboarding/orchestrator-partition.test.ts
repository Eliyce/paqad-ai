import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ORCHESTRATOR_GROUP_FILES } from './orchestrator-harness.js';
import ORIGINAL_TITLES from './orchestrator-titles.json';

const here = dirname(fileURLToPath(import.meta.url));

function unescape(literal: string): string {
  return literal.replace(/\\(.)/g, '$1');
}

function titlesOf(source: string): string[] {
  const titles: string[] = [];
  for (const match of source.matchAll(/^\s*it\(\s*'((?:[^'\\]|\\.)*)'/gm))
    titles.push(unescape(match[1]));
  for (const match of source.matchAll(/^\s*\] as const\)\(\s*'((?:[^'\\]|\\.)*)'/gm)) {
    titles.push(unescape(match[1]));
  }
  return titles;
}

const sources = ORCHESTRATOR_GROUP_FILES.map((file) => readFileSync(join(here, file), 'utf8'));

describe('onboarding orchestrator partition', () => {
  it('AC-1: replaces the single orchestrator test file with four group files', () => {
    expect(existsSync(join(here, 'orchestrator.test.ts'))).toBe(false);
    expect(ORCHESTRATOR_GROUP_FILES).toHaveLength(4);
    for (const file of ORCHESTRATOR_GROUP_FILES) expect(existsSync(join(here, file))).toBe(true);
  });

  it('AC-2: wraps every group in the OnboardingOrchestrator describe so full test names stay the same', () => {
    for (const source of sources) {
      expect(source).toMatch(/^describe\('OnboardingOrchestrator', \(\) => \{$/m);
    }
  });

  it('AC-1 AC-2: keeps exactly the 70 original test titles across the groups, none in two places', () => {
    const titles = sources.flatMap(titlesOf);
    expect(ORIGINAL_TITLES).toHaveLength(70);
    expect([...titles].sort()).toEqual(ORIGINAL_TITLES);
    expect(titles).toHaveLength(70);
    expect(new Set(titles).size).toBe(titles.length);
    for (const source of sources) expect(titlesOf(source).length).toBeGreaterThan(0);
  });

  it('keeps the one table-driven stack command test with its six stacks', () => {
    const eachCalls = sources.flatMap((source) => [...source.matchAll(/\bit\.each\(/g)]);
    expect(eachCalls).toHaveLength(1);
    const g2 = sources[1];
    const table = g2.slice(g2.indexOf('it.each(['), g2.indexOf('] as const)('));
    expect([...table.matchAll(/^ {4}\[$/gm)]).toHaveLength(6);
  });

  it('keeps the optional-package mock only in the group whose RAG tests use it', () => {
    const mocked = sources.map((source) => source.includes("vi.mock('@/core/optional-package.js'"));
    expect(mocked).toEqual([true, false, false, false]);
  });
});
