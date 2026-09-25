import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { writeCodeKnowledgeIndex } from '@/code-knowledge/store.js';
import { CODE_KNOWLEDGE_SCHEMA_VERSION } from '@/code-knowledge/types.js';
import {
  NoActiveFeatureError,
  ReuseDeclarationError,
  readFeaturePlan,
  readFeatureReview,
  readFeatureSpecification,
  writeFeaturePlan,
  writeFeatureReview,
  writeFeatureSpecification,
} from '@/feature-evidence/artifacts.js';
import type { PlanReuse } from '@/feature-evidence/reuse.js';
import { validatePlanRecord, validateReviewRecord } from '@/feature-evidence/schema.js';
import { featureDir, featureFilePath } from '@/feature-evidence/paths.js';
import { ENVELOPE_HEADER_KEYS, splitFrontMatter } from '@/feature-evidence/envelope.js';
import { sha256Hex } from '@/compliance/markdown.js';
import { readFeatureRecord } from '@/feature-evidence/feature-record.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import type { FeatureSpec } from '@/core/types/feature-spec.js';

const roots: string[] = [];
function tempRoot(): string {
  const r = mkdtempSync(join(tmpdir(), 'paqad-fe-artifacts-'));
  roots.push(r);
  return r;
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

const clock = () => new Date('2026-07-10T00:00:00.000Z');

/** Write a file inside the project, creating its parent directories. */
function writeFileSync2(root: string, rel: string, content: string): void {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

/** Open an active feature and return its dir name. */
function activeFeature(root: string): string {
  return openFeatureChange(root, 'ses_1', {
    adapter: 'claude-code',
    title: 'Route first workflows',
    issue: '339',
    ulid: '01JABCDEFGHJKMNPQRSTVWXYZ0',
  });
}

/** The signed source `frozenSpec()` was built from. */
const SPEC_MD = '# S-339\n\n- FR-1: does the thing\n';

function frozenSpec(): FeatureSpec {
  return {
    schema_version: '1',
    spec_id: 'S-339',
    spec_file: '.paqad/specs/S-339.md',
    spec_hash: sha256Hex(SPEC_MD),
    behaviour: ['does the thing'],
    acceptance_criteria: [],
    invariants: [],
    open_questions: [],
    frozen: {
      frozen_at: clock().toISOString(),
      spec_hash: sha256Hex(SPEC_MD),
      signed_off_by: 'me',
    },
  };
}

/** A minimal valid reuse declaration (issue #357) — every plan compile now needs one. */
function reuse(): PlanReuse {
  return {
    consulted: [{ source: 'index-query', query: 'router', hits: 0 }],
    reusing: [],
    new_constructs: [],
  };
}

describe('writeFeaturePlan', () => {
  it('compiles a schema-valid plan.json into the active feature, keyed by the dir name', () => {
    const root = tempRoot();
    const dir = activeFeature(root);
    const result = writeFeaturePlan(root, 'ses_1', {
      summary: 'Route every prompt to one of nine workflows',
      steps: [{ id: 's1', description: 'wire the router' }],
      modules_touched: ['pipeline'],
      reuse: reuse(),
      now: clock,
    });
    expect(result.dirName).toBe(dir);
    expect(result.path).toBe(`.paqad/ledger/feature-evidence/${dir}/plan.json`);
    // Issue #581 — the envelope header, with the change key from the dir name; the change
    // identity (issue / title / slug) lives in feature.json only.
    expect(result.record).toMatchObject({
      schema_version: 2,
      doc_type: 'paqad.plan',
      change: '01JABCDEFGHJKMNPQRSTVWXYZ0',
      session_id: 'ses_1',
      recorded_at: clock().toISOString(),
    });
    for (const key of ['issue', 'title', 'slug', 'ulid', 'created_at', 'updated_at']) {
      expect(result.record).not.toHaveProperty(key);
    }
    expect(readFeatureRecord(root, dir)).toMatchObject({
      issue: '339',
      slug: 'route-first-workflows',
    });
    expect(validatePlanRecord(result.record)).toEqual([]);
    const readBack = readFeaturePlan(root, dir);
    expect(readBack?.content_hash).toBe(result.record.content_hash);
    expect(readBack?.reuse?.consulted).toHaveLength(1);
  });

  it('throws NoActiveFeatureError when no feature is active', () => {
    const root = tempRoot();
    expect(() => writeFeaturePlan(root, 'ses_1', { summary: 'x', reuse: reuse() })).toThrow(
      NoActiveFeatureError,
    );
  });

  // Issue #357 — the reuse gate runs before anything is resolved, so a plan that has not
  // answered "did you check what already exists?" leaves no trace at all (INV-5).
  it('refuses a plan with no reuse section and writes nothing', () => {
    const root = tempRoot();
    const dir = activeFeature(root);
    expect(() => writeFeaturePlan(root, 'ses_1', { summary: 'x' })).toThrow(ReuseDeclarationError);
    expect(readFeaturePlan(root, dir)).toBeNull();
  });
});

describe('writeFeatureSpecification', () => {
  it('writes a frozen spec as specification.json in the active feature', () => {
    const root = tempRoot();
    const dir = activeFeature(root);
    const result = writeFeatureSpecification(root, 'ses_1', frozenSpec(), SPEC_MD);
    expect(result.path).toBe(`.paqad/ledger/feature-evidence/${dir}/specification.json`);
    expect(readFeatureSpecification(root, dir)?.spec_id).toBe('S-339');
  });

  it('has no specification.json before the freeze (AC-27)', () => {
    const root = tempRoot();
    const dir = activeFeature(root);
    expect(existsSync(join(root, featureFilePath(dir, 'specification')))).toBe(false);
    expect(readFeatureSpecification(root, dir)).toBeNull();
  });

  it('copies the signed source in as spec.md, its body hashing to spec_hash (AC-9)', () => {
    const root = tempRoot();
    const dir = activeFeature(root);
    const { record } = writeFeatureSpecification(root, 'ses_1', frozenSpec(), SPEC_MD);
    const text = readFileSync(join(root, featureFilePath(dir, 'specMd')), 'utf8');
    const { header, body } = splitFrontMatter(text);
    expect(body).toBe(SPEC_MD);
    expect(sha256Hex(body)).toBe(record.spec_hash);
    expect(Object.keys(header!)).toEqual([...ENVELOPE_HEADER_KEYS]);
    expect(header).toMatchObject({
      schema_version: 2,
      doc_type: 'paqad.spec',
      change: '01JABCDEFGHJKMNPQRSTVWXYZ0',
      session_id: 'ses_1',
      content_hash: record.spec_hash,
    });
    // The re-rendered projection is gone (D5).
    expect(readdirSync(join(root, featureDir(dir)))).not.toContain('specification.md');
  });

  it('stamps specification.json with the envelope header and spec_file spec.md', () => {
    const root = tempRoot();
    const dir = activeFeature(root);
    writeFeatureSpecification(root, 'ses_1', frozenSpec(), SPEC_MD);
    const raw = JSON.parse(
      readFileSync(join(root, featureFilePath(dir, 'specification')), 'utf8'),
    ) as Record<string, unknown>;
    expect(Object.keys(raw).slice(0, 6)).toEqual([...ENVELOPE_HEADER_KEYS]);
    expect(raw).toMatchObject({
      schema_version: 2,
      doc_type: 'paqad.specification',
      change: '01JABCDEFGHJKMNPQRSTVWXYZ0',
      session_id: 'ses_1',
      spec_file: 'spec.md',
      spec_id: 'S-339',
    });
    expect(raw.content_hash).toMatch(/^[0-9a-f]{64}$/);
    for (const banned of ['ts', 'created_at', 'captured_at', 'generated_at', 'time_verified']) {
      expect(raw).not.toHaveProperty(banned);
    }
  });

  it('refuses a source that does not hash to spec_hash, writing nothing', () => {
    const root = tempRoot();
    const dir = activeFeature(root);
    expect(() => writeFeatureSpecification(root, 'ses_1', frozenSpec(), 'edited\n')).toThrow(
      /does not hash/,
    );
    expect(existsSync(join(root, featureFilePath(dir, 'specMd')))).toBe(false);
    expect(existsSync(join(root, featureFilePath(dir, 'specification')))).toBe(false);
  });

  it('refuses an unfrozen spec', () => {
    const root = tempRoot();
    activeFeature(root);
    expect(() =>
      writeFeatureSpecification(root, 'ses_1', { ...frozenSpec(), frozen: null }, SPEC_MD),
    ).toThrow(/unfrozen/);
  });

  it('throws NoActiveFeatureError when no feature is active', () => {
    const root = tempRoot();
    expect(() => writeFeatureSpecification(root, 'ses_1', frozenSpec(), SPEC_MD)).toThrow(
      NoActiveFeatureError,
    );
  });

  it('reads null for an absent specification.json', () => {
    expect(readFeatureSpecification(tempRoot(), 'nope-01JABCDEFGHJKMNPQRSTVWXYZ0')).toBeNull();
  });
});

// Issue #402 — the review stage's rigid artifact. Before this, review owned no bundle
// file, so its evidence was an agent-authored .md dropped wherever the model chose.
describe('writeFeatureReview', () => {
  const template = {
    summary: 'Checked correctness, regressions and rollback.',
    verdict: 'safe-to-merge' as const,
    findings: [{ severity: 'minor' as const, description: 'naming nit', file: 'src/a.ts' }],
    checked: ['correctness', 'regressions'],
    rollback: 'Revert the commit; no data migration ran.',
    now: clock,
  };

  it('writes review.json into the active feature with identity from the dir name', () => {
    const root = tempRoot();
    const dir = activeFeature(root);
    const result = writeFeatureReview(root, 'ses_1', template);
    expect(result.path).toBe(`.paqad/ledger/feature-evidence/${dir}/review.json`);
    const record = readFeatureReview(root, dir);
    expect(record?.doc_type).toBe('paqad.review');
    // The change key is taken from the dir, never from the model; the identity is not repeated.
    expect(record?.change).toBe('01JABCDEFGHJKMNPQRSTVWXYZ0');
    expect(record?.session_id).toBe('ses_1');
    for (const key of ['issue', 'title', 'slug', 'ulid', 'created_at']) {
      expect(record).not.toHaveProperty(key);
    }
    expect(record?.verdict).toBe('safe-to-merge');
    expect(record?.findings).toHaveLength(1);
    expect(validateReviewRecord(record)).toEqual([]);
  });

  it('stamps a deterministic content_hash that ignores the volatile timestamps', () => {
    const root = tempRoot();
    const dir = activeFeature(root);
    const first = writeFeatureReview(root, 'ses_1', template).record;
    const second = writeFeatureReview(root, 'ses_1', {
      ...template,
      now: () => new Date('2026-07-11T00:00:00.000Z'),
    }).record;
    expect(second.recorded_at).not.toBe(first.recorded_at);
    expect(second.content_hash).toBe(first.content_hash);
    expect(readFeatureReview(root, dir)?.content_hash).toBe(first.content_hash);
  });

  it('defaults findings and checked to empty arrays', () => {
    const root = tempRoot();
    activeFeature(root);
    const record = writeFeatureReview(root, 'ses_1', {
      summary: 'nothing found',
      verdict: 'safe-to-merge',
      rollback: 'revert',
      now: clock,
    }).record;
    expect(record.findings).toEqual([]);
    expect(record.checked).toEqual([]);
  });

  it('throws on a record the schema rejects rather than persisting it', () => {
    const root = tempRoot();
    const dir = activeFeature(root);
    expect(() =>
      writeFeatureReview(root, 'ses_1', {
        ...template,
        verdict: 'looks-fine' as unknown as 'safe-to-merge',
      }),
    ).toThrow(/Invalid review\.json/);
    expect(readFeatureReview(root, dir)).toBeNull();
  });

  it('throws NoActiveFeatureError when no feature is active', () => {
    const root = tempRoot();
    expect(() => writeFeatureReview(root, 'ses_1', template)).toThrow(NoActiveFeatureError);
  });

  it('reads null for an absent review.json', () => {
    expect(readFeatureReview(tempRoot(), 'nope-01JABCDEFGHJKMNPQRSTVWXYZ0')).toBeNull();
  });
});

describe('evidence-armed reuse pause at plan compile (#361)', () => {
  function seedIndex(root: string): void {
    mkdirSync(join(root, 'src/utils'), { recursive: true });
    writeFileSync(join(root, 'src/utils/dates.ts'), 'export function formatIsoDate() {}\n');
    writeCodeKnowledgeIndex(root, {
      schema_version: CODE_KNOWLEDGE_SCHEMA_VERSION,
      header: {
        generated_at: '2026-07-21T00:00:00.000Z',
        branch: 'main',
        head_commit: null,
        schema_version: CODE_KNOWLEDGE_SCHEMA_VERSION,
        entry_point_globs: [],
      },
      symbols: [
        {
          name: 'formatIsoDate',
          kind: 'function',
          file: 'src/utils/dates.ts',
          line: 1,
          signature: 'formatIsoDate()',
          exported: true,
          module_slug: 'utils',
          extraction_tier: 'regex',
          caller_count: 5,
          orphan: false,
        },
      ],
      files: [{ path: 'src/utils/dates.ts', caller_count: 5, orphan: false, entry_point: false }],
      import_edges: [],
      reference_edges: [],
      dependencies: [],
    });
  }

  const forkingReuse = (): PlanReuse => ({
    consulted: [{ source: 'index-query', query: 'date formatting', hits: 1 }],
    reusing: [],
    new_constructs: [{ name: 'formatRelativeDate', justification: 'need the relative form' }],
  });

  it('opens a pause for the declared fork in strict mode and reports its id', () => {
    const root = tempRoot();
    writeFileSync2(root, '.paqad/configs/.config.policy', 'decision_arm_mode=strict\n');
    seedIndex(root);
    activeFeature(root);

    const result = writeFeaturePlan(root, 'ses_1', {
      summary: 'Add relative date formatting',
      reuse: forkingReuse(),
      now: clock,
    });

    expect(result.armedDecisions).toHaveLength(1);
    expect(readdirSync(join(root, '.paqad/decisions/pending'))).toHaveLength(1);
    // The plan itself is still written — arming rides on top, it does not gate the compile.
    expect(readFeaturePlan(root, result.dirName)).not.toBeNull();
  });

  it('reports the fork as a warning in the shipped warn default, minting nothing', () => {
    const root = tempRoot();
    seedIndex(root);
    activeFeature(root);

    const result = writeFeaturePlan(root, 'ses_1', {
      summary: 'Add relative date formatting',
      reuse: forkingReuse(),
      now: clock,
    });

    expect(result.armedDecisions).toEqual([]);
    expect(result.warnings?.some((line) => line.includes('formatIsoDate'))).toBe(true);
    expect(existsSync(join(root, '.paqad/decisions/pending'))).toBe(false);
  });

  it('arms nothing when the plan declares no new constructs', () => {
    const root = tempRoot();
    writeFileSync2(root, '.paqad/configs/.config.policy', 'decision_arm_mode=strict\n');
    seedIndex(root);
    activeFeature(root);

    const result = writeFeaturePlan(root, 'ses_1', {
      summary: 'Tidy the router',
      reuse: reuse(),
      now: clock,
    });
    expect(result.armedDecisions).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('AC-4: compiles normally with no index built', () => {
    const root = tempRoot();
    writeFileSync2(root, '.paqad/configs/.config.policy', 'decision_arm_mode=strict\n');
    activeFeature(root);

    const result = writeFeaturePlan(root, 'ses_1', {
      summary: 'Add relative date formatting',
      reuse: forkingReuse(),
      now: clock,
    });
    expect(result.armedDecisions).toEqual([]);
    expect(readFeaturePlan(root, result.dirName)).not.toBeNull();
  });
});
