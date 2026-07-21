import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import { featureFilePath } from '@/feature-evidence/paths.js';
import { writeReviewDigest } from '@/review-digest/index.js';

// Issue #360 — the write seam reads the cached inputs and persists the digest. It must
// never throw on a missing input (every source degrades to "none recorded") and must never
// write inside a feature bundle directory (INV-3).
describe('writeReviewDigest', () => {
  let root: string;
  const SES = 'ses_review_digest';
  const NOW = () => new Date('2026-07-21T08:00:00.000Z');

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-digest-write-'));
    mkdirSync(join(root, '.paqad'), { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function write(relative: string, body: unknown): void {
    const target = join(root, relative);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, JSON.stringify(body), 'utf8');
  }

  function activeFeature(): string {
    return openFeatureChange(root, SES, {
      adapter: 'claude-code',
      title: 'Review digest',
      issue: '360',
      ulid: '01JABCDEFGHJKMNPQRSTVWXYZ0',
    });
  }

  it('writes an honest digest in a project with nothing recorded at all', () => {
    const result = writeReviewDigest(root, SES, NOW);

    expect(result.path).toBe(PATHS.REVIEW_DIGEST);
    expect(result.feature).toBeNull();
    expect(result.findings).toBe(0);
    const onDisk = readFileSync(join(root, PATHS.REVIEW_DIGEST), 'utf8');
    expect(onDisk).toBe(result.markdown);
    expect(onDisk).toContain('No machine findings recorded');
  });

  it('reads the active feature, its frozen criteria, its stages and the machine findings', () => {
    const dirName = activeFeature();
    writeFileSync(
      join(root, featureFilePath(dirName, 'specification')),
      JSON.stringify({
        acceptance_criteria: [
          { criterion_id: 'AC-1', given: 'g', when: 'w', then: 't', proof_type: 'test' },
        ],
      }),
      'utf8',
    );
    write(PATHS.CHANGED_FILES, ['src/a.ts']);
    write(PATHS.RULE_SCRIPTS_REPORT, {
      results: [
        {
          rule_id: 'RL-6740',
          script: 'a.mjs',
          kind: 'deterministic',
          findings: [{ file: 'src/a.ts', line: 4, message: 'docs disagree', severity: 'high' }],
        },
      ],
    });

    const result = writeReviewDigest(root, SES, NOW);

    expect(result.feature).toBe(dirName);
    expect(result.findings).toBe(1);
    expect(result.markdown).toContain(`- Feature: ${dirName}`);
    expect(result.markdown).toContain('  - src/a.ts');
    expect(result.markdown).toContain('- AC-1 [test] — given g, when w, then t');
    expect(result.markdown).toContain('src/a.ts:4');
    // The change header reports the stages the ledger folded, not a claim of its own.
    expect(result.markdown).toMatch(/- Stages: \w+=/);
  });

  it('degrades a corrupt changed-file list and a corrupt specification to "none recorded"', () => {
    const dirName = activeFeature();
    mkdirSync(dirname(join(root, PATHS.CHANGED_FILES)), { recursive: true });
    writeFileSync(join(root, PATHS.CHANGED_FILES), '{not json', 'utf8');
    writeFileSync(join(root, featureFilePath(dirName, 'specification')), 'not json', 'utf8');

    const result = writeReviewDigest(root, SES, NOW);

    expect(result.markdown).toContain('- Changed files: none recorded');
    expect(result.markdown).toContain('No frozen acceptance criteria on record');
  });

  it('ignores a changed-file list that is valid JSON but not a list of strings', () => {
    write(PATHS.CHANGED_FILES, { files: ['src/a.ts'] });
    expect(writeReviewDigest(root, SES, NOW).markdown).toContain('- Changed files: none recorded');

    write(PATHS.CHANGED_FILES, ['src/a.ts', 7]);
    expect(writeReviewDigest(root, SES, NOW).markdown).toContain('- Changed files (1):');
  });

  it('skips criteria when the frozen spec records none', () => {
    activeFeature();
    const dirName = writeReviewDigest(root, SES, NOW).feature!;
    writeFileSync(
      join(root, featureFilePath(dirName, 'specification')),
      JSON.stringify({ behaviour: ['x'] }),
      'utf8',
    );
    expect(writeReviewDigest(root, SES, NOW).markdown).toContain(
      'No frozen acceptance criteria on record',
    );
  });

  it('writes outside every feature bundle directory (INV-3)', () => {
    const dirName = activeFeature();
    writeReviewDigest(root, SES, NOW);
    expect(PATHS.REVIEW_DIGEST.startsWith('.paqad/session/')).toBe(true);
    expect(PATHS.REVIEW_DIGEST).not.toContain(dirName);
  });
});
