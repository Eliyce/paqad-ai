import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  budgetWarningLine,
  buildOverlapReport,
  candidateText,
  catalogBudget,
  discoverInstalledSkills,
  findCollisions,
  findNameShadowing,
  overlapScore,
  renderOverlapReport,
  shadowingLine,
  wordSet,
  type InstalledArtifact,
  type OverlapCandidate,
} from '@/authoring/overlap.js';
import { meetsThreshold } from '@/authoring/thresholds.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function installed(
  name: string,
  description: string,
  scope: 'project' | 'user' = 'project',
): InstalledArtifact {
  return { kind: 'skill', name, description, path: `.claude/skills/${name}/SKILL.md`, scope };
}

function candidate(name: string, text: string): OverlapCandidate {
  return { kind: 'skill', name, text, scope: 'project' };
}

describe('the word-set score', () => {
  it('lowercases, drops stop words and scores Jaccard', () => {
    expect([...wordSet('Use this skill when the INVOICE arrives')]).toEqual(['invoice', 'arrives']);
    expect(overlapScore('invoice pdf parse', 'parse invoice pdf')).toBe(1);
    expect(overlapScore('invoice pdf', 'invoice csv')).toBeCloseTo(1 / 3);
  });

  it('AC-35: text that is empty after stop words scores 0 and never collides', () => {
    expect(overlapScore('the and of when', 'invoice pdf')).toBe(0);
    expect(overlapScore('invoice pdf', '')).toBe(0);
    const result = findCollisions(candidate('x-ing', 'the of a'), [installed('y', 'the a')], 0.4);
    expect(result.collisions).toEqual([]);
  });

  it('joins purpose and triggers into one candidate text', () => {
    expect(candidateText('parse invoices', ['an invoice pdf', 'billing'])).toBe(
      'parse invoices an invoice pdf billing',
    );
  });
});

describe('AC-13, AC-53: collisions at the threshold', () => {
  it('collides at 0.4 and not at 0.39 or below', () => {
    const existing = installed('processing-invoices', 'alpha beta gamma delta epsilon');
    const at = findCollisions(candidate('reading-invoices', 'alpha beta'), [existing], 0.4);
    expect(at.collisions).toEqual([
      {
        candidate: 'reading-invoices',
        existing: 'processing-invoices',
        existing_path: '.claude/skills/processing-invoices/SKILL.md',
        score: 0.4,
      },
    ]);
    const below = findCollisions(candidate('reading-invoices', 'alpha'), [existing], 0.4);
    expect(below.collisions).toEqual([]);
    expect(below.scores).toEqual([{ existing: 'processing-invoices', score: 0.2 }]);
    expect(meetsThreshold(0.39, 0.4)).toBe(false);
  });

  it('INV-18: a score of 0.4 computed as 0.39999... still collides', () => {
    const computed = 0.7 - 0.3;
    expect(computed).toBeLessThan(0.4);
    expect(meetsThreshold(computed, 0.4)).toBe(true);
  });

  it('skips the candidate itself and other artifact kinds', () => {
    const agent: InstalledArtifact = { ...installed('agent-x', 'alpha beta'), kind: 'agent' };
    const result = findCollisions(
      candidate('self-ing', 'alpha beta'),
      [installed('self-ing', 'alpha beta'), agent],
      0.4,
    );
    expect(result.scores).toEqual([]);
  });
});

describe('EC-06: cross-scope name shadowing', () => {
  it('says the user skill shadows the new project one and asks for a rename', () => {
    const user = {
      ...installed('processing-invoices', 'x', 'user'),
      path: '~/.claude/skills/processing-invoices/SKILL.md',
    };
    const entries = findNameShadowing(candidate('processing-invoices', 'y'), [user]);
    expect(entries).toEqual([
      {
        name: 'processing-invoices',
        shadowing: { scope: 'user', path: '~/.claude/skills/processing-invoices/SKILL.md' },
        shadowed: { scope: 'project', path: null },
      },
    ]);
    expect(shadowingLine(entries[0]!)).toBe(
      'The name processing-invoices is taken in another scope: ' +
        '~/.claude/skills/processing-invoices/SKILL.md (user) would shadow the new project one. ' +
        'Pick another name.',
    );
  });

  it('says a new user skill shadows an existing project one', () => {
    const entries = findNameShadowing({ ...candidate('processing-invoices', 'y'), scope: 'user' }, [
      installed('processing-invoices', 'x'),
    ]);
    expect(entries[0]).toMatchObject({
      shadowing: { scope: 'user', path: null },
      shadowed: { scope: 'project' },
    });
  });

  it('reports nothing for the same name in the same scope', () => {
    expect(findNameShadowing(candidate('a-ing', 'x'), [installed('a-ing', 'x')])).toEqual([]);
  });
});

describe('AC-14, EC-14: the catalog description budget', () => {
  const skills = [
    installed('aa', 'x'.repeat(40)),
    installed('bb', 'y'.repeat(40)),
    installed('cc', 'z'.repeat(40)),
  ];

  it('is within budget below the limit', () => {
    const budget = catalogBudget({ installed: skills, budgetChars: 8000 });
    expect(budget).toMatchObject({ total_chars: 120, over_budget: false, at_risk: [] });
    expect(budgetWarningLine(budget)).toBeNull();
  });

  it('warns and names skills least recently fired first, never-fired before any fired', () => {
    const budget = catalogBudget({
      installed: skills,
      candidate: { name: 'dd', description: 'w'.repeat(40) },
      budgetChars: 90,
      lastFired: new Map([
        ['aa', '2026-10-30T00:00:00.000Z'],
        ['cc', '2026-10-01T00:00:00.000Z'],
      ]),
    });
    expect(budget).toMatchObject({ total_chars: 160, over_budget: true, at_risk: ['bb', 'cc'] });
    expect(budget.activation_data).toBe(true);
    expect(budgetWarningLine(budget)).toBe(
      'The skill descriptions add up to 160 characters, over the budget of 90. ' +
        'The host may drop these from its list: bb, cc.',
    );
  });

  it('falls back to name order with no activation data', () => {
    const budget = catalogBudget({ installed: skills, budgetChars: 50 });
    expect(budget.at_risk).toEqual(['aa', 'bb']);
    expect(budget.activation_data).toBe(false);
  });
});

describe('discovering installed skills', () => {
  function write(root: string, rel: string, content: string): void {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), content);
  }

  it('reads project and user skills through the skill roots', () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-overlap-'));
    const home = mkdtempSync(join(tmpdir(), 'paqad-overlap-home-'));
    roots.push(root, home);
    write(
      root,
      '.claude/skills/processing-invoices/SKILL.md',
      '---\nname: processing-invoices\ndescription: Parses invoices. Use when an invoice arrives.\n---\n',
    );
    write(root, '.agents/skills/no-frontmatter/SKILL.md', 'just text\n');
    write(root, '.claude/skills/README.md', 'not a skill\n');
    write(
      root,
      'runtime/capabilities/sec/skills/auditing-auth/SKILL.md',
      '---\nname: auditing-auth\ndescription: d\n---\n',
    );
    write(
      home,
      '.claude/skills/drafting-notes/SKILL.md',
      '---\nname: drafting-notes\ndescription: Drafts notes.\n---\n',
    );

    const found = discoverInstalledSkills(
      root,
      { adapters: ['claude-code'], paqadRepo: true },
      { userHome: home },
    );
    expect(found.map((skill) => [skill.scope, skill.name, skill.path])).toEqual([
      ['project', 'processing-invoices', '.claude/skills/processing-invoices/SKILL.md'],
      ['project', 'no-frontmatter', '.agents/skills/no-frontmatter/SKILL.md'],
      ['project', 'auditing-auth', 'runtime/capabilities/sec/skills/auditing-auth/SKILL.md'],
      ['user', 'drafting-notes', '~/.claude/skills/drafting-notes/SKILL.md'],
    ]);
    expect(found[1]!.description).toBe('');
    expect(
      discoverInstalledSkills(
        root,
        { adapters: ['claude-code'], paqadRepo: false },
        { userHome: null },
      ).map((skill) => skill.name),
    ).toEqual(['processing-invoices', 'no-frontmatter']);
  });
});

describe('the overlap report', () => {
  it('collects collisions, shadowing and budget, and renders overlap.md without em dashes', () => {
    const report = buildOverlapReport({
      candidate: candidate('reading-invoices', 'alpha beta'),
      installed: [
        installed('processing-invoices', 'alpha beta gamma'),
        installed('drafting-notes', 'notes'),
      ],
      threshold: 0.4,
      budgetChars: 8000,
      candidateDescription: 'Reads invoices. Use when an invoice arrives.',
    });
    expect(report.collisions.map((collision) => collision.existing)).toEqual([
      'processing-invoices',
    ]);
    const markdown = renderOverlapReport(report);
    expect(markdown).toContain(
      '- reading-invoices collides with processing-invoices (.claude/skills/processing-invoices/SKILL.md), score 0.67. Extending processing-invoices is recommended.',
    );
    expect(markdown).toContain('| drafting-notes | 0.00 |');
    expect(markdown).toContain('No activation data yet');
    expect(markdown).not.toContain(String.fromCodePoint(0x2014));
  });

  it('says none when nothing collides', () => {
    const markdown = renderOverlapReport(
      buildOverlapReport({
        candidate: candidate('reading-invoices', 'alpha'),
        installed: [],
        threshold: 0.4,
        budgetChars: 8000,
      }),
    );
    expect(markdown).toContain('None: no installed skill scores at or above the threshold.');
    expect(markdown).toContain('No other installed skill.');
  });
});
