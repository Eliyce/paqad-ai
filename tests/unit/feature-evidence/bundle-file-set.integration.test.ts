// Issue #581 — the M0-M5 oracle, end to end. For each config case a whole change runs in a
// temp project (see bundle-run.fixture.ts) and the bundle must hold exactly the case's files
// (AC-1), with `.paqad/_specs/` absent after every single step (AC-2). M0 proves the late
// gates reach evidence.jsonl with enterprise off (AC-13), M5 proves experts without the
// pipeline require no experts.json (AC-21), and an untitled run proves a pipeline change is
// renamed by plan compile with nothing left under its old name (AC-17).

import { readdirSync, readFileSync, rmSync, statSync } from 'node:fs';

import { join, relative } from 'pathe';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { readFeatureEvidence } from '@/feature-evidence/bundle-ledgers.js';
import { featureDir, parseFeatureDirName } from '@/feature-evidence/paths.js';
import { currentFeature, readFeatureStageUnit } from '@/feature-evidence/stage-ledger.js';

import {
  bundlePath,
  RUN_SESSION,
  CASE_FILES,
  CHANGE_DEPENDENT_FILES,
  ORACLE_CASES,
  runBundleFixture,
  type BundleRun,
} from './bundle-run.fixture.js';

// Windows CI is slow and each case drives a full change plus verification.
const E2E_TIMEOUT = 90_000;

const runs: BundleRun[] = [];
afterEach(() => {
  while (runs.length > 0) rmSync(runs.pop()!.root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

async function run(...args: Parameters<typeof runBundleFixture>): Promise<BundleRun> {
  const result = await runBundleFixture(...args);
  runs.push(result);
  return result;
}

/** Every path under `dir`, relative to it, posix separators, directories included. */
function walk(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    out.push(relative(base, abs));
    if (statSync(abs).isDirectory()) out.push(...walk(abs, base));
  }
  return out;
}

describe('the #581 file-set oracle (AC-1, AC-2)', () => {
  it.each(ORACLE_CASES)(
    '%s leaves exactly its listed files and never creates .paqad/_specs',
    async (caseId) => {
      const result = await run(caseId);
      const files = readdirSync(bundlePath(result)).sort();
      expect(files).toEqual([...CASE_FILES[caseId], ...CHANGE_DEPENDENT_FILES].sort());
      // And the completeness gate agrees: nothing required is missing, nothing was backfilled.
      const gate = readFeatureEvidence(result.root, result.dir).find(
        (row) => row.code === 'bundle-completeness',
      );
      expect(gate?.verdict, gate?.detail ?? '').toBe('pass');
      // The AC-2 check ran after every step, verbs and turn-end seams alike.
      expect(result.steps).toContain('repository verification');
      expect(result.steps.length).toBeGreaterThan(10);
    },
    E2E_TIMEOUT,
  );
});

describe('the passing turn closes the change after its evidence is written', () => {
  it.each(ORACLE_CASES)(
    '%s closes on the turn it passes, with evidence.jsonl already in the bundle',
    async (caseId) => {
      const result = await run(caseId);
      const rows = readFeatureStageUnit(result.root, result.dir);
      // The change passed and was closed, and the close is the LAST row: nothing the verifier
      // wrote for this change landed after the change was released.
      expect(rows.at(-1)?.kind).toBe('close');
      expect(rows.filter((row) => row.kind === 'close')).toHaveLength(1);
      expect(currentFeature(result.root, RUN_SESSION)).toBeNull();
      // And that same turn wrote the evidence rows, the completeness gate among them.
      const evidence = readFeatureEvidence(result.root, result.dir);
      expect(evidence.length).toBeGreaterThan(0);
      expect(evidence.some((row) => row.code === 'bundle-completeness')).toBe(true);
    },
    E2E_TIMEOUT,
  );
});

describe('a change the completeness gate fails stays open', () => {
  it(
    'keeps the change active for the redo loop instead of closing it',
    async () => {
      const result = await run('M1', {
        beforeVerification: (root, dir) => rmSync(join(root, featureDir(dir), 'review.json')),
      });
      const gate = readFeatureEvidence(result.root, result.dir).find(
        (row) => row.code === 'bundle-completeness',
      );
      expect(gate?.verdict).toBe('fail');
      const rows = readFeatureStageUnit(result.root, result.dir);
      expect(rows.some((row) => row.kind === 'close')).toBe(false);
      expect(currentFeature(result.root, RUN_SESSION)).toBe(result.dir);
    },
    E2E_TIMEOUT,
  );
});

describe('evidence.jsonl is always on (AC-13)', () => {
  it(
    'M0 records one row each for the late gates, a skipped one with its reason',
    async () => {
      const result = await run('M0');
      const rows = readFeatureEvidence(result.root, result.dir);
      for (const code of ['bundle-completeness', 'visual-evidence', 'rules-loaded']) {
        expect(
          rows.filter((row) => row.code === code),
          code,
        ).toHaveLength(1);
      }
      const skipped = rows.filter((row) => row.verdict === 'skipped');
      expect(skipped.length).toBeGreaterThan(0);
      expect(skipped.every((row) => (row.detail ?? '').length > 0)).toBe(true);
      expect(rows.find((row) => row.code === 'visual-evidence')?.verdict).toBe('skipped');
    },
    E2E_TIMEOUT,
  );
});

describe('experts without the pipeline (AC-21)', () => {
  it(
    'M5 does not require experts.json and the gate names no missing file',
    async () => {
      const result = await run('M5');
      const gate = readFeatureEvidence(result.root, result.dir).find(
        (row) => row.code === 'bundle-completeness',
      )!;
      const detail = gate.detail ?? '';
      expect(gate.verdict).toBe('pass');
      expect(detail).toContain('Every required bundle file is present');
      expect(detail).not.toMatch(/missing/i);
      // experts.json is only ever named as not required here (the pipeline is off).
      const [required, skipped = ''] = detail.split('Skipped (flag off):');
      expect(required).not.toContain('experts.json');
      expect(skipped).toContain('experts.json');
    },
    E2E_TIMEOUT,
  );
});

describe('a change-<ULID> pipeline bundle renamed by plan compile (AC-17)', () => {
  it(
    'leaves one renamed folder and nothing under the old name anywhere in .paqad',
    async () => {
      let untitled: string | null = null;
      const result = await run('M3', {
        untitled: true,
        afterStep: (root) => {
          if (untitled) return;
          const dirs = readdirSync(join(root, '.paqad', 'ledger', 'feature-evidence')).filter(
            (name) => name.startsWith('change-'),
          );
          untitled = dirs[0] ?? null;
        },
      });
      expect(untitled).toMatch(/^change-/);
      expect(result.dir).toBe(
        `PROJ-123-checkout-page-cleanup-${parseFeatureDirName(untitled!)!.ulid}`,
      );
      const bundles = readdirSync(join(result.root, '.paqad', 'ledger', 'feature-evidence')).filter(
        (name) => name !== '_session' && name !== '_chat',
      );
      expect(bundles).toEqual([result.dir]);
      // Nothing under the old name anywhere in .paqad: no path, and no file content.
      const paqad = join(result.root, '.paqad');
      for (const path of walk(paqad)) {
        expect(path).not.toContain(untitled!);
        const abs = join(paqad, path);
        if (statSync(abs).isFile()) {
          expect(readFileSync(abs, 'utf8'), path).not.toContain(untitled!);
        }
      }
      expect(readdirSync(bundlePath(result)).sort()).toEqual(
        [...CASE_FILES.M3, ...CHANGE_DEPENDENT_FILES].sort(),
      );
    },
    E2E_TIMEOUT,
  );
});
