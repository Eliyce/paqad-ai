import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildCodeKnowledgeIndex } from '@/code-knowledge/builder.js';
import { writeCodeKnowledgeIndex } from '@/code-knowledge/store.js';
import { PATHS } from '@/core/constants/paths.js';
import { DEFAULT_EXISTING_SURFACE_TOKENS } from '@/core/project-intelligence.js';
import {
  EXISTING_SURFACE_FRAMING,
  EXISTING_SURFACE_HEADING,
  composeExistingSurfaceSection,
  gatherExistingSurface,
  selectCandidateFiles,
  type ExistingSurfaceCard,
} from '@/context/existing-surface.js';
import { writeRuleContext } from '@/context/rule-context.js';

/** 4-bytes-per-token estimate, mirroring the section's own budgeter. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function write(root: string, rel: string, body: string): void {
  const target = join(root, rel);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, body);
}

describe('composeExistingSurfaceSection (pure format)', () => {
  const cards: ExistingSurfaceCard[] = [
    {
      name: 'buildProjectRepoMap',
      signature: 'buildProjectRepoMap(projectRoot, options): Promise<RepoMapResult>',
      file: 'src/rag/repo-map.ts',
      line: 230,
      callerCount: 3,
      module: 'hybrid-rag',
    },
    {
      name: 'pageRank',
      signature: 'pageRank(seedNodes, edges, options)',
      file: 'src/rag/repo-map.ts',
      line: 38,
      callerCount: 1,
      module: 'hybrid-rag',
    },
  ];

  it('pins the heading, verbatim framing line, and card format (AC-5)', () => {
    const section = composeExistingSurfaceSection(cards);
    expect(section).toContain(
      `${EXISTING_SURFACE_HEADING} — 2 existing symbols for the files in play`,
    );
    expect(section).toContain(EXISTING_SURFACE_FRAMING);
    expect(section).toContain(
      '- `buildProjectRepoMap(projectRoot, options): Promise<RepoMapResult>` — src/rag/repo-map.ts:230 · called from 3 places · hybrid-rag',
    );
    // Singular "place" for exactly one caller.
    expect(section).toContain('· called from 1 place · hybrid-rag');
  });

  it('returns "" for no cards so it can be appended unconditionally', () => {
    expect(composeExistingSurfaceSection([])).toBe('');
  });

  it('falls back to the name when no signature, and omits :line / callers when unknown', () => {
    const section = composeExistingSurfaceSection([{ name: 'doThing', file: 'src/a.ts' }]);
    expect(section).toContain('- `doThing` — src/a.ts\n');
    expect(section).not.toContain('called from');
  });

  it('truncates by rank and appends the honest truncation line within budget (AC-4)', () => {
    const many: ExistingSurfaceCard[] = Array.from({ length: 200 }, (_unused, index) => ({
      name: `symbol${index}`,
      signature: `symbol${index}(argumentOne, argumentTwo, argumentThree): SomeLongReturnType`,
      file: `src/huge/module-${index}.ts`,
      line: index + 1,
      callerCount: index,
      module: 'huge',
    }));
    const section = composeExistingSurfaceSection(many, { tokenBudget: 200 });
    expect(section).toMatch(/…and \d+ more exported symbols — run `paqad-ai index query <name>`/);
    // The rendered section respects the token budget (with a small allowance for the
    // trailing truncation line, which is appended after the budget like the repo-map).
    expect(estimateTokens(section)).toBeLessThanOrEqual(200 + 40);
    // First (highest-rank) card survives; a late one is dropped.
    expect(section).toContain('`symbol0(');
    expect(section).not.toContain('symbol199(');
  });
});

describe('selectCandidateFiles', () => {
  const files = ['src/context/foo.ts', 'src/context/bar.ts', 'src/rag/other.ts', 'src/cli/z.ts'];

  it('scopes to the working-set modules', () => {
    const picked = selectCandidateFiles(files, ['src/context/foo.ts'], '', null);
    expect(picked.sort()).toEqual(['src/context/bar.ts', 'src/context/foo.ts']);
  });

  it('pulls in files the prompt names by basename', () => {
    const picked = selectCandidateFiles(files, [], 'please look at other.ts behaviour', null);
    expect(picked).toContain('src/rag/other.ts');
  });

  it('returns nothing when neither the working set nor the prompt implicate anything', () => {
    expect(selectCandidateFiles(files, [], '   ', null)).toEqual([]);
  });

  it('pulls in a file whose exported symbol the prompt names (index path)', () => {
    const index = {
      symbols: [{ name: 'renderWidget', file: 'src/cli/z.ts' }],
    } as unknown as Parameters<typeof selectCandidateFiles>[3];
    const picked = selectCandidateFiles(files, [], 'reuse renderWidget please', index);
    expect(picked).toContain('src/cli/z.ts');
  });
});

describe('gatherExistingSurface (IO)', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-existing-surface-'));
    write(
      root,
      PATHS.MODULE_MAP,
      ['version: 2', 'modules:', '  - slug: context', '    sources: [src/context]'].join('\n'),
    );
    write(root, 'package.json', JSON.stringify({ main: 'src/cli/index.ts' }));
    // Two files in the same module, with an import edge so PageRank is meaningful.
    write(
      root,
      'src/context/helpers.ts',
      [
        'export function firstHelper(a: number): number { return a; }',
        'export function secondHelper(b: string): string { return b; }',
        'export function thirdHelper(): void {}',
        'export const FOURTH = 4;',
      ].join('\n'),
    );
    write(
      root,
      'src/context/consumer.ts',
      [
        "import { firstHelper } from './helpers.js';",
        'export function useIt(): number { return firstHelper(1); }',
        'export function alsoHere(): void {}',
      ].join('\n'),
    );
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  async function buildIndex(): Promise<void> {
    const index = await buildCodeKnowledgeIndex(root, {
      now: () => '2026-07-14T00:00:00.000Z',
      gitState: { branch: 'main', head_commit: 'abc123' },
    });
    writeCodeKnowledgeIndex(root, index);
  }

  it('renders >=5 signature cards for the working set within budget (AC-1)', async () => {
    await buildIndex();
    const section = await gatherExistingSurface(root, {
      changedPaths: ['src/context/consumer.ts'],
      tokenBudget: DEFAULT_EXISTING_SURFACE_TOKENS,
    });
    const cardCount = (section.match(/^- /gm) ?? []).length;
    expect(cardCount).toBeGreaterThanOrEqual(5);
    expect(section).toContain(EXISTING_SURFACE_HEADING);
    // Signatures + caller counts come from the code-knowledge index.
    expect(section).toContain('firstHelper');
    expect(section).toMatch(/called from \d+ place/);
    expect(estimateTokens(section)).toBeLessThanOrEqual(DEFAULT_EXISTING_SURFACE_TOKENS + 40);
  });

  it('renders name-only cards from the repo-map resolvers when the index is absent (AC-3)', async () => {
    // No index built — pure fallback path.
    const section = await gatherExistingSurface(root, {
      changedPaths: ['src/context/consumer.ts'],
    });
    expect(section).toContain(EXISTING_SURFACE_HEADING);
    expect(section).toContain('firstHelper');
    // Name-only: no caller counts (those need the index).
    expect(section).not.toContain('called from');
  });

  it('returns "" when nothing is implicated (empty working set, no prompt)', async () => {
    await buildIndex();
    expect(await gatherExistingSurface(root, { changedPaths: [] })).toBe('');
  });

  it('returns "" with no options at all (default budget, no working set, no query)', async () => {
    await buildIndex();
    expect(await gatherExistingSurface(root)).toBe('');
  });
});

describe('route gating (AC-2 / INV-1)', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-surface-gate-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('drops the existing-surface section on a non-feature-development route', async () => {
    // A project-question route (loadRules:false) that still retrieves: the artifact must
    // carry the retrieval slice but NEVER the existing-surface section, even though a
    // caller passed one.
    const target = await writeRuleContext(root, {
      loadRules: false,
      existingSurfaceSection: `${EXISTING_SURFACE_HEADING} — 3 existing symbols for the files in play\n${EXISTING_SURFACE_FRAMING}\n\n- \`x()\` — src/a.ts:1\n`,
      retrievalSection: '## Retrieved context — 1 slice relevant to the files in play\n> hint\n',
    });
    expect(target).not.toBeNull();
    const written = readFileSync(target as string, 'utf8');
    expect(written).toContain('## Retrieved context');
    expect(written).not.toContain(EXISTING_SURFACE_HEADING);
  });

  it('keeps the existing-surface section on the feature-development route', async () => {
    const target = await writeRuleContext(root, {
      loadRules: true,
      existingSurfaceSection: `${EXISTING_SURFACE_HEADING} — 1 existing symbol for the files in play\n${EXISTING_SURFACE_FRAMING}\n\n- \`x()\` — src/a.ts:1\n`,
    });
    expect(target).not.toBeNull();
    const written = readFileSync(target as string, 'utf8');
    expect(written).toContain(EXISTING_SURFACE_HEADING);
  });
});
