import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { detectUndeclaredDecisionSignals } from '@/planning/slice-scope-guard.js';

import { createManifest } from './fixtures.js';

describe('slice scope guard undeclared decision detection', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'slice-scope-undeclared-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('flags a new component file when a reusable sibling already exists', () => {
    mkdirSync(join(root, 'src/components'), { recursive: true });
    writeFileSync(join(root, 'src/components/Button.tsx'), 'export const Button = 1;\n', 'utf8');
    writeFileSync(
      join(root, 'src/components/ButtonV2.tsx'),
      'export const ButtonV2 = 1;\n',
      'utf8',
    );

    const findings = detectUndeclaredDecisionSignals({
      projectRoot: root,
      slice: {
        ...createManifest().execution_slices[0],
        goal: 'Should we reuse existing code or create new support?',
        touches: ['src/components/ButtonV2.tsx'],
      },
      modifiedFiles: ['src/components/ButtonV2.tsx'],
    });

    expect(findings).toEqual([
      {
        category: 'create-vs-reuse',
        file: 'src/components/ButtonV2.tsx',
        matched_existing: 'src/components/Button.tsx',
        reason:
          'undeclared_decision: created src/components/ButtonV2.tsx while src/components/Button.tsx already existed as a reuse candidate',
      },
    ]);
  });

  it('flags multiple touched paths for alternative architecture forks and ignores non-forks', () => {
    mkdirSync(join(root, 'src/components'), { recursive: true });
    writeFileSync(join(root, 'src/components/Button.tsx'), 'export const Button = 1;\n', 'utf8');

    const architectureFindings = detectUndeclaredDecisionSignals({
      projectRoot: root,
      slice: {
        ...createManifest().execution_slices[0],
        goal: 'We could use this service or alternatively another path',
        touches: ['src/a.ts', 'src/b.ts'],
      },
      modifiedFiles: ['src/a.ts', 'src/b.ts'],
    });

    expect(architectureFindings).toEqual([
      {
        category: 'architecture-path',
        file: 'src/a.ts',
        reason:
          'undeclared_decision: multiple implementation paths were touched (src/a.ts, src/b.ts) without a declared decision',
      },
    ]);
    expect(
      detectUndeclaredDecisionSignals({
        projectRoot: root,
        slice: {
          ...createManifest().execution_slices[0],
          goal: 'We could use this service or alternatively another path',
          touches: [],
        },
        modifiedFiles: [],
      }),
    ).toEqual([]);

    expect(
      detectUndeclaredDecisionSignals({
        projectRoot: root,
        slice: {
          ...createManifest().execution_slices[0],
          goal: 'Implement the dashboard action.',
          touches: ['src/components/CardV2.tsx'],
        },
        modifiedFiles: ['src/components/CardV2.tsx'],
      }),
    ).toEqual([]);

    expect(
      detectUndeclaredDecisionSignals({
        projectRoot: root,
        slice: {
          ...createManifest().execution_slices[0],
          goal: 'Should we reuse existing code or create new support?',
          touches: ['src/components/ModalV2.tsx'],
        },
        modifiedFiles: ['src/components/ModalV2.tsx'],
      }),
    ).toEqual([]);

    expect(
      detectUndeclaredDecisionSignals({
        projectRoot: root,
        slice: {
          ...createManifest().execution_slices[0],
          goal: 'Implement the dashboard action.',
          touches: ['src/components/ButtonV2.tsx'],
        },
        modifiedFiles: ['src/components/ButtonV2.tsx'],
      }),
    ).toEqual([
      {
        category: 'create-vs-reuse',
        file: 'src/components/ButtonV2.tsx',
        matched_existing: 'src/components/Button.tsx',
        reason:
          'undeclared_decision: created src/components/ButtonV2.tsx while src/components/Button.tsx already existed as a reuse candidate',
      },
    ]);
  });

  it('dedupes repeated sibling findings and ignores files without directories or matching folders', () => {
    mkdirSync(join(root, 'src/components'), { recursive: true });
    writeFileSync(join(root, 'src/components/Button.tsx'), 'export const Button = 1;\n', 'utf8');
    writeFileSync(
      join(root, 'src/components/ButtonV2.tsx'),
      'export const ButtonV2 = 1;\n',
      'utf8',
    );

    const duplicatedFindings = detectUndeclaredDecisionSignals({
      projectRoot: root,
      slice: {
        ...createManifest().execution_slices[0],
        goal: 'Should we reuse existing code or create new support?',
        touches: ['src/components/ButtonV2.tsx'],
      },
      modifiedFiles: ['src/components/ButtonV2.tsx', 'src/components/ButtonV2.tsx'],
    });
    expect(
      duplicatedFindings.filter((finding) => finding.category === 'create-vs-reuse'),
    ).toHaveLength(1);

    writeFileSync(join(root, 'src/components/Button.jsx'), 'export const Button = 1;\n', 'utf8');
    expect(
      detectUndeclaredDecisionSignals({
        projectRoot: root,
        slice: {
          ...createManifest().execution_slices[0],
          goal: 'Implement dashboard action.',
          touches: ['src/components/---.ts', 'src/components/ButtonV3.ts'],
        },
        modifiedFiles: ['src/components/---.ts', 'src/components/ButtonV3.ts'],
      }),
    ).toEqual([]);

    mkdirSync(join(root, 'src'), { recursive: true });
    rmSync(join(root, 'src'), { recursive: true, force: true });
    writeFileSync(join(root, 'src'), 'not a directory', 'utf8');
    expect(
      detectUndeclaredDecisionSignals({
        projectRoot: root,
        slice: {
          ...createManifest().execution_slices[0],
          goal: 'Implement dashboard action.',
          touches: ['ButtonV2.tsx', 'src/Other.tsx'],
        },
        modifiedFiles: ['ButtonV2.tsx', 'src/Other.tsx'],
      }),
    ).toEqual([]);
    expect(
      detectUndeclaredDecisionSignals({
        projectRoot: root,
        slice: {
          ...createManifest().execution_slices[0],
          goal: 'Implement dashboard action.',
          touches: ['src/missing/Other.tsx'],
        },
        modifiedFiles: ['src/missing/Other.tsx'],
      }),
    ).toEqual([]);
  });
});
