import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { writeCodeKnowledgeIndex } from '@/code-knowledge/store.js';
import {
  CODE_KNOWLEDGE_SCHEMA_VERSION,
  type CodeKnowledgeIndex,
  type CodeKnowledgeSymbol,
} from '@/code-knowledge/types.js';
import { resolvePendingDecision, type PendingContractDecision } from '@/decisions/authoring.js';
import type { DuplicationFinding } from '@/duplication/types.js';
import type { DecisionArmConfig } from '@/planning/decision-arm-config.js';
import {
  armDecisionFromDuplicationFinding,
  armDecisionFromPlan,
  buildReuseForkEvidence,
  duplicationForkKey,
  findPlanTimeReuseForks,
  planForkKey,
  reuseOptionKey,
  CREATE_NEW_OPTION_KEY,
} from '@/planning/decision-evidence-arm.js';

const CHANGE = '361-armed-01KY000000000000000000000';

function makeProject(): string {
  return mkdtempSync(join(tmpdir(), 'paqad-arm-'));
}

function writeFile(root: string, rel: string, content: string): void {
  const abs = join(root, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content);
}

function symbol(overrides: Partial<CodeKnowledgeSymbol> = {}): CodeKnowledgeSymbol {
  return {
    name: 'formatIsoDate',
    kind: 'function',
    file: 'src/utils/dates.ts',
    line: 12,
    signature: 'formatIsoDate(value: Date): string',
    exported: true,
    module_slug: 'utils',
    extraction_tier: 'regex',
    caller_count: 5,
    orphan: false,
    ...overrides,
  };
}

/** Write an index holding `symbols`, and create each symbol's file so mtime resolves. */
function seedIndex(root: string, symbols: CodeKnowledgeSymbol[]): CodeKnowledgeIndex {
  const index: CodeKnowledgeIndex = {
    schema_version: CODE_KNOWLEDGE_SCHEMA_VERSION,
    header: {
      generated_at: '2026-07-21T00:00:00.000Z',
      branch: 'main',
      head_commit: null,
      schema_version: CODE_KNOWLEDGE_SCHEMA_VERSION,
      entry_point_globs: [],
    },
    symbols,
    files: symbols.map((entry) => ({
      path: entry.file,
      caller_count: entry.caller_count,
      orphan: false,
      entry_point: false,
    })),
    import_edges: [],
    reference_edges: [],
    dependencies: [],
  };
  for (const entry of symbols) {
    writeFile(root, entry.file, `export function ${entry.name}() {}\n`);
  }
  writeCodeKnowledgeIndex(root, index);
  return index;
}

function config(overrides: Partial<DecisionArmConfig> = {}): DecisionArmConfig {
  return { mode: 'strict', planThreshold: 0.85, maxPerChange: 1, ...overrides };
}

function pendingPackets(root: string): PendingContractDecision[] {
  const dir = join(root, '.paqad', 'decisions', 'pending');
  let files: string[];
  try {
    files = readdirSync(dir).filter((name) => name.endsWith('.json'));
  } catch {
    return [];
  }
  return files
    .sort()
    .map((name) => JSON.parse(readFileSync(join(dir, name), 'utf8')) as PendingContractDecision);
}

function finding(overrides: Partial<DuplicationFinding> = {}): DuplicationFinding {
  return {
    file: 'src/stamp.ts',
    line_range: { start: 12, end: 19 },
    matched_file: 'src/utils/dates.ts',
    matched_symbol: 'formatIsoDate',
    matched_line_range: { start: 1, end: 8 },
    similarity: 0.93,
    matched_callers: 4,
    corroborated: false,
    kind: 'deterministic',
    message: 'near-copy of formatIsoDate',
    ...overrides,
  };
}

describe('buildReuseForkEvidence', () => {
  it('carries the file, callers, similarity, and the file mtime', () => {
    const root = makeProject();
    writeFile(root, 'src/utils/dates.ts', 'export const a = 1;\n');
    const evidence = buildReuseForkEvidence({
      projectRoot: root,
      file: 'src/utils/dates.ts',
      callers: 5,
      similarity: 0.871,
    });
    expect(evidence.file).toBe('src/utils/dates.ts');
    expect(evidence.callers).toBe(5);
    expect(evidence.similarity).toBe(0.87);
    expect(Date.parse(evidence.last_modified ?? '')).not.toBeNaN();
    expect(evidence.evidence_partial).toBeUndefined();
  });

  it('marks evidence partial rather than guessing a timestamp for a missing file', () => {
    const evidence = buildReuseForkEvidence({
      projectRoot: makeProject(),
      file: 'src/gone.ts',
      callers: 0,
      similarity: 0.9,
    });
    expect(evidence.last_modified).toBeUndefined();
    expect(evidence.evidence_partial).toBe(true);
  });

  it('clamps an out-of-range similarity into [0, 1]', () => {
    const root = makeProject();
    expect(
      buildReuseForkEvidence({ projectRoot: root, file: 'a.ts', callers: 0, similarity: 4 })
        .similarity,
    ).toBe(1);
    expect(
      buildReuseForkEvidence({ projectRoot: root, file: 'a.ts', callers: 0, similarity: -2 })
        .similarity,
    ).toBe(0);
  });
});

describe('findPlanTimeReuseForks', () => {
  it('finds the fork when a planned construct near-duplicates an indexed symbol', () => {
    const root = makeProject();
    seedIndex(root, [symbol()]);
    const forks = findPlanTimeReuseForks({
      projectRoot: root,
      constructs: [{ name: 'formatRelativeDate', justification: 'relative form' }],
      threshold: 0.85,
    });
    expect(forks).toHaveLength(1);
    expect(forks[0].existing.name).toBe('formatIsoDate');
    expect(forks[0].forkKey).toBe(planForkKey('formatRelativeDate', 'formatIsoDate'));
    expect(forks[0].similarity).toBeGreaterThanOrEqual(0.85);
  });

  it('finds nothing when nothing scores above the threshold', () => {
    const root = makeProject();
    seedIndex(root, [symbol({ name: 'renderInvoicePdf', file: 'src/pdf.ts' })]);
    expect(
      findPlanTimeReuseForks({
        projectRoot: root,
        constructs: [{ name: 'formatRelativeDate' }],
        threshold: 0.85,
      }),
    ).toEqual([]);
  });

  it('AC-4: returns nothing when no index has been built', () => {
    expect(
      findPlanTimeReuseForks({
        projectRoot: makeProject(),
        constructs: [{ name: 'formatRelativeDate' }],
        threshold: 0.85,
      }),
    ).toEqual([]);
  });

  it('ignores a symbol of the same name — an edit or rename is not a reuse fork', () => {
    const root = makeProject();
    seedIndex(root, [symbol({ name: 'formatRelativeDate' })]);
    expect(
      findPlanTimeReuseForks({
        projectRoot: root,
        constructs: [{ name: 'formatRelativeDate' }],
        threshold: 0.85,
      }),
    ).toEqual([]);
  });

  it('returns forks strongest first', () => {
    const root = makeProject();
    seedIndex(root, [
      symbol(),
      symbol({ name: 'parseUserRecord', file: 'src/users.ts', module_slug: 'users' }),
    ]);
    const forks = findPlanTimeReuseForks({
      projectRoot: root,
      constructs: [{ name: 'parseUserRecords' }, { name: 'formatRelativeDate' }],
      threshold: 0.85,
    });
    expect(forks.map((fork) => fork.newName)).toEqual(['parseUserRecords', 'formatRelativeDate']);
  });

  it('scores nothing for an empty construct list', () => {
    const root = makeProject();
    seedIndex(root, [symbol()]);
    expect(findPlanTimeReuseForks({ projectRoot: root, constructs: [], threshold: 0.85 })).toEqual(
      [],
    );
  });

  it('takes an injected index without touching disk', () => {
    const root = makeProject();
    expect(
      findPlanTimeReuseForks({
        projectRoot: root,
        constructs: [{ name: 'formatRelativeDate' }],
        threshold: 0.85,
        index: null,
      }),
    ).toEqual([]);
  });
});

describe('armDecisionFromPlan', () => {
  it('AC-1: mints one packet carrying the real callers, similarity, and reuse recommendation', () => {
    const root = makeProject();
    seedIndex(root, [symbol()]);

    const result = armDecisionFromPlan({
      projectRoot: root,
      changeKey: CHANGE,
      config: config(),
      constructs: [{ name: 'formatRelativeDate', justification: 'need the relative form' }],
    });

    expect(result.minted).toHaveLength(1);
    const packets = pendingPackets(root);
    expect(packets).toHaveLength(1);

    const packet = packets[0];
    expect(packet.category).toBe('create-vs-reuse');
    expect(packet.origin).toBe('evidence-armed');
    expect(packet.recommendation).toBe(reuseOptionKey('formatIsoDate'));

    const reuseOption = packet.options.find(
      (option) => option.option_key === reuseOptionKey('formatIsoDate'),
    );
    expect(reuseOption?.evidence?.callers).toBe(5);
    expect(reuseOption?.evidence?.similarity).toBeGreaterThan(0);
    expect(reuseOption?.evidence?.similarity).toBeLessThanOrEqual(1);
    expect(reuseOption?.evidence?.file).toBe('src/utils/dates.ts');

    // The create side carries the plan's own justification verbatim.
    const createOption = packet.options.find(
      (option) => option.option_key === CREATE_NEW_OPTION_KEY,
    );
    expect(createOption?.label).toContain('need the relative form');
    expect(createOption?.evidence).toBeUndefined();
  });

  it('recommends nothing when the existing symbol has too few callers to argue from', () => {
    const root = makeProject();
    seedIndex(root, [symbol({ caller_count: 1 })]);
    armDecisionFromPlan({
      projectRoot: root,
      changeKey: CHANGE,
      config: config(),
      constructs: [{ name: 'formatRelativeDate' }],
    });
    expect(pendingPackets(root)[0].recommendation).toBeNull();
  });

  it('labels the create option honestly when the plan gave no justification', () => {
    const root = makeProject();
    seedIndex(root, [symbol()]);
    armDecisionFromPlan({
      projectRoot: root,
      changeKey: CHANGE,
      config: config(),
      constructs: [{ name: 'formatRelativeDate' }],
    });
    const packet = pendingPackets(root)[0];
    expect(
      packet.options.find((option) => option.option_key === CREATE_NEW_OPTION_KEY)?.label,
    ).toContain('no justification given');
    expect(packet.context).toContain('(none given)');
  });

  it('AC-2: auto-applies a prior answer instead of asking the same fork again', () => {
    const root = makeProject();
    seedIndex(root, [symbol()]);
    const constructs = [{ name: 'formatRelativeDate', justification: 'relative form' }];

    const first = armDecisionFromPlan({
      projectRoot: root,
      changeKey: CHANGE,
      config: config(),
      constructs,
    });
    resolvePendingDecision(root, first.minted[0], CREATE_NEW_OPTION_KEY, 'different semantics');

    const second = armDecisionFromPlan({
      projectRoot: root,
      changeKey: 'a-later-change-01KY111111111111111111111',
      config: config(),
      constructs,
    });

    expect(second.minted).toEqual([]);
    expect(second.reusedDecisions).toEqual([`reused_decision:${first.minted[0]}`]);
    expect(pendingPackets(root)).toEqual([]);
  });

  it('never asks the same fork twice while its packet is still pending', () => {
    const root = makeProject();
    seedIndex(root, [symbol()]);
    const constructs = [{ name: 'formatRelativeDate' }];
    armDecisionFromPlan({ projectRoot: root, changeKey: CHANGE, config: config(), constructs });
    const second = armDecisionFromPlan({
      projectRoot: root,
      changeKey: CHANGE,
      config: config(),
      constructs,
    });
    expect(second.minted).toEqual([]);
    expect(second.reusedDecisions).toEqual([]);
    expect(pendingPackets(root)).toHaveLength(1);
  });

  it('AC-3: with max_per_change=1 only the strongest fork mints; the other is reported', () => {
    const root = makeProject();
    seedIndex(root, [
      symbol(),
      symbol({ name: 'parseUserRecord', file: 'src/users.ts', module_slug: 'users' }),
    ]);

    const result = armDecisionFromPlan({
      projectRoot: root,
      changeKey: CHANGE,
      config: config({ maxPerChange: 1 }),
      constructs: [{ name: 'formatRelativeDate' }, { name: 'parseUserRecords' }],
    });

    expect(result.minted).toHaveLength(1);
    expect(result.warnings).toHaveLength(1);
    // The suppressed fork is named, not silently dropped.
    expect(result.warnings[0]).toContain('formatRelativeDate');
    expect(pendingPackets(root)[0].title).toContain('parseUserRecord');
  });

  it('counts packets already open for the change against the cap', () => {
    const root = makeProject();
    seedIndex(root, [
      symbol(),
      symbol({ name: 'parseUserRecord', file: 'src/users.ts', module_slug: 'users' }),
    ]);
    armDecisionFromPlan({
      projectRoot: root,
      changeKey: CHANGE,
      config: config(),
      constructs: [{ name: 'parseUserRecords' }],
    });
    const second = armDecisionFromPlan({
      projectRoot: root,
      changeKey: CHANGE,
      config: config(),
      constructs: [{ name: 'formatRelativeDate' }],
    });
    expect(second.minted).toEqual([]);
    expect(second.warnings).toHaveLength(1);
  });

  it('warn mode reports the fork and mints nothing', () => {
    const root = makeProject();
    seedIndex(root, [symbol()]);
    const result = armDecisionFromPlan({
      projectRoot: root,
      changeKey: CHANGE,
      config: config({ mode: 'warn' }),
      constructs: [{ name: 'formatRelativeDate' }],
    });
    expect(result.minted).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('formatIsoDate');
    expect(pendingPackets(root)).toEqual([]);
  });

  it('AC-6: off mode neither mints nor reports', () => {
    const root = makeProject();
    seedIndex(root, [symbol()]);
    const result = armDecisionFromPlan({
      projectRoot: root,
      changeKey: CHANGE,
      config: config({ mode: 'off' }),
      constructs: [{ name: 'formatRelativeDate' }],
    });
    expect(result).toEqual({ minted: [], warnings: [], reusedDecisions: [] });
    expect(pendingPackets(root)).toEqual([]);
  });

  it('AC-4: compiles to nothing when the index is absent, without throwing', () => {
    const root = makeProject();
    const result = armDecisionFromPlan({
      projectRoot: root,
      changeKey: CHANGE,
      config: config(),
      constructs: [{ name: 'formatRelativeDate' }],
    });
    expect(result).toEqual({ minted: [], warnings: [], reusedDecisions: [] });
    expect(pendingPackets(root)).toEqual([]);
  });

  it('INV-4: degrades to nothing armed when the decision store cannot be written', () => {
    const root = makeProject();
    seedIndex(root, [symbol()]);
    // A FILE where the pending directory must be — every write into it fails.
    writeFile(root, '.paqad/decisions/pending', 'not a directory');
    expect(() =>
      armDecisionFromPlan({
        projectRoot: root,
        changeKey: CHANGE,
        config: config(),
        constructs: [{ name: 'formatRelativeDate' }],
      }),
    ).not.toThrow();
  });

  it('resolves its own config when none is injected', () => {
    const root = makeProject();
    seedIndex(root, [symbol()]);
    // No config file anywhere ⇒ the shipped `warn` default ⇒ reported, never minted.
    const result = armDecisionFromPlan({
      projectRoot: root,
      changeKey: CHANGE,
      env: {},
      constructs: [{ name: 'formatRelativeDate' }],
    });
    expect(result.minted).toEqual([]);
    expect(result.warnings).toHaveLength(1);
  });
});

describe('armDecisionFromDuplicationFinding', () => {
  it('AC-5: mints from a finding with the finding evidence on the reuse option', () => {
    const root = makeProject();
    writeFile(root, 'src/utils/dates.ts', 'export function formatIsoDate() {}\n');

    const result = armDecisionFromDuplicationFinding({
      projectRoot: root,
      changeKey: CHANGE,
      config: config(),
      finding: finding(),
    });

    expect(result.minted).toHaveLength(1);
    const packet = pendingPackets(root)[0];
    expect(packet.category).toBe('create-vs-reuse');
    expect(packet.origin).toBe('evidence-armed');
    expect(packet.recommendation).toBe(reuseOptionKey('formatIsoDate'));

    const evidence = packet.options.find(
      (option) => option.option_key === reuseOptionKey('formatIsoDate'),
    )?.evidence;
    expect(evidence).toEqual({
      file: 'src/utils/dates.ts',
      callers: 4,
      similarity: 0.93,
      last_modified: expect.any(String),
    });

    // #358's correlation token survives, so applyResolvedDecisions can still match it back.
    expect(packet.context).toContain('[paqad-duplication src/stamp.ts:12:src/utils/dates.ts]');
    expect(packet.context).toContain(`[paqad-arm ${duplicationForkKey(finding())}]`);
  });

  it('falls back to the matched file when the finding resolved no symbol', () => {
    const root = makeProject();
    const result = armDecisionFromDuplicationFinding({
      projectRoot: root,
      changeKey: CHANGE,
      config: config(),
      finding: finding({ matched_symbol: undefined }),
    });
    expect(result.minted).toHaveLength(1);
    expect(pendingPackets(root)[0].options[0].option_key).toBe(
      reuseOptionKey('src/utils/dates.ts'),
    );
  });

  it('recommends nothing when too few callers depend on the matched code', () => {
    const root = makeProject();
    armDecisionFromDuplicationFinding({
      projectRoot: root,
      changeKey: CHANGE,
      config: config(),
      finding: finding({ matched_callers: 0 }),
    });
    expect(pendingPackets(root)[0].recommendation).toBeNull();
  });

  it('AC-6: off mode neither mints nor reports', () => {
    const root = makeProject();
    const result = armDecisionFromDuplicationFinding({
      projectRoot: root,
      changeKey: CHANGE,
      config: config({ mode: 'off' }),
      finding: finding(),
    });
    expect(result).toEqual({ minted: [], warnings: [], reusedDecisions: [] });
    expect(pendingPackets(root)).toEqual([]);
  });

  it('warn mode surfaces the finding message rather than opening a pause', () => {
    const root = makeProject();
    const result = armDecisionFromDuplicationFinding({
      projectRoot: root,
      changeKey: CHANGE,
      config: config({ mode: 'warn' }),
      finding: finding(),
    });
    expect(result.minted).toEqual([]);
    expect(result.warnings).toEqual(['near-copy of formatIsoDate']);
  });

  it('resolves its own config when none is injected', () => {
    const root = makeProject();
    const result = armDecisionFromDuplicationFinding({
      projectRoot: root,
      changeKey: CHANGE,
      env: {},
      finding: finding(),
    });
    expect(result.minted).toEqual([]);
    expect(result.warnings).toHaveLength(1);
  });

  it('does not re-ask a fork answered in an earlier change', () => {
    const root = makeProject();
    const first = armDecisionFromDuplicationFinding({
      projectRoot: root,
      changeKey: CHANGE,
      config: config(),
      finding: finding(),
    });
    resolvePendingDecision(root, first.minted[0], CREATE_NEW_OPTION_KEY, 'intentional copy');

    const second = armDecisionFromDuplicationFinding({
      projectRoot: root,
      changeKey: 'another-change-01KY222222222222222222222',
      config: config(),
      finding: finding(),
    });
    expect(second.minted).toEqual([]);
    expect(second.reusedDecisions).toEqual([`reused_decision:${first.minted[0]}`]);
  });
});
