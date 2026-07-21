import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { writeCodeKnowledgeIndex } from '@/code-knowledge/store.js';
import { CODE_KNOWLEDGE_SCHEMA_VERSION } from '@/code-knowledge/types.js';
import { PATHS } from '@/core/constants/paths.js';
import {
  assembleDecisionEvidence,
  countFileReferences,
  defaultSimilarityFor,
} from '@/planning/decision-evidence.js';

describe('decision evidence', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'decision-evidence-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('fills file, last_modified, callers, similarity, and rule_match when evidence exists', () => {
    mkdirSync(join(root, 'src/components'), { recursive: true });
    mkdirSync(join(root, 'src/screens'), { recursive: true });
    mkdirSync(join(root, '.paqad'), { recursive: true });
    writeFileSync(join(root, 'src/components/Button.tsx'), 'export const Button = 1;\n', 'utf8');
    writeFileSync(
      join(root, 'src/screens/Home.tsx'),
      "import { Button } from '../components/Button';\n",
      'utf8',
    );
    writeFileSync(
      join(root, PATHS.COMPILED_RULES),
      JSON.stringify({
        rules: [{ rule_id: 'RULE-1', trigger_patterns: ['src/components/Button.tsx'] }],
      }),
      'utf8',
    );

    const evidence = assembleDecisionEvidence({
      projectRoot: root,
      file: 'src/components/Button.tsx',
      category: 'component-reuse',
      similarity: 0.91,
    });

    expect(evidence).toMatchObject({
      file: 'src/components/Button.tsx',
      callers: 2,
      similarity: 0.91,
      rule_match: 'RULE-1',
    });
    expect(evidence.last_modified).toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(evidence.evidence_partial).toBeUndefined();
  });

  it('marks evidence as partial when the file does not exist', () => {
    const evidence = assembleDecisionEvidence({
      projectRoot: root,
      file: 'src/components/NewButton.tsx',
      category: 'component-reuse',
      similarity: 0.42,
    });

    expect(evidence).toEqual({
      file: 'src/components/NewButton.tsx',
      callers: 0,
      similarity: 0.42,
      evidence_partial: true,
    });
  });

  it('counts zero references when the target file is missing and computes fallback similarity bands', () => {
    expect(countFileReferences(root, 'src/missing.ts')).toBe(0);
    expect(defaultSimilarityFor('workflow-or-tool', false, 0)).toBe(0.44);
    expect(defaultSimilarityFor('component-reuse', true, 4)).toBe(0.92);
  });

  it('covers fallback readers, wildcard rule matching, and similarity clamps', () => {
    mkdirSync(join(root, 'src'), { recursive: true });
    mkdirSync(join(root, '.paqad'), { recursive: true });
    writeFileSync(join(root, 'src/tool.ts'), 'export const tool = true;\n', 'utf8');
    writeFileSync(join(root, 'src/notes.md'), 'tool\n', 'utf8');
    writeFileSync(
      join(root, PATHS.COMPILED_RULES),
      JSON.stringify({ rules: [{ rule_id: 'RULE-ALL', trigger_patterns: ['**'] }] }),
      'utf8',
    );

    const evidence = assembleDecisionEvidence({
      projectRoot: root,
      file: 'src/tool.ts',
      category: 'workflow-or-tool',
      similarity: 9,
    });
    expect(evidence.similarity).toBe(0.99);
    expect(evidence.rule_match).toBe('RULE-ALL');

    writeFileSync(join(root, 'file-root.txt'), 'not a directory');
    expect(countFileReferences(join(root, 'file-root.txt'), 'src/tool.ts')).toBe(0);
  });

  it('ignores broken directory entries and unreadable sibling files when counting references', () => {
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src/tool.ts'), 'export const tool = true;\n', 'utf8');
    writeFileSync(join(root, 'src/consumer.ts'), "import './tool';\n", 'utf8');
    symlinkSync(join(root, 'src/missing.md'), join(root, 'src/broken.md'));

    expect(countFileReferences(root, 'src/tool.ts')).toBeGreaterThanOrEqual(2);
  });
});

describe('index-backed callers (#361)', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'decision-evidence-index-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function seedIndex(files: Array<{ path: string; caller_count: number }>): void {
    writeCodeKnowledgeIndex(root, {
      schema_version: CODE_KNOWLEDGE_SCHEMA_VERSION,
      header: {
        generated_at: '2026-07-21T00:00:00.000Z',
        branch: 'main',
        head_commit: null,
        schema_version: CODE_KNOWLEDGE_SCHEMA_VERSION,
        entry_point_globs: [],
      },
      symbols: [],
      files: files.map((file) => ({ ...file, orphan: false, entry_point: false })),
      import_edges: [],
      reference_edges: [],
      dependencies: [],
    });
  }

  it('takes callers from the index instead of the whole-tree walk when one is built', () => {
    mkdirSync(join(root, 'src/utils'), { recursive: true });
    writeFileSync(join(root, 'src/utils/dates.ts'), 'export const a = 1;\n', 'utf8');
    seedIndex([{ path: 'src/utils/dates.ts', caller_count: 12 }]);

    const evidence = assembleDecisionEvidence({
      projectRoot: root,
      file: 'src/utils/dates.ts',
      category: 'create-vs-reuse',
      similarity: 0.9,
    });
    // The tree holds one referencing file at most; 12 can only have come from the index.
    expect(evidence.callers).toBe(12);
    expect(evidence.similarity).toBe(0.9);
    expect(evidence.last_modified).toBeDefined();
  });

  it('carries the rule match on the index path too', () => {
    mkdirSync(join(root, 'src/utils'), { recursive: true });
    mkdirSync(join(root, '.paqad'), { recursive: true });
    writeFileSync(join(root, 'src/utils/dates.ts'), 'export const a = 1;\n', 'utf8');
    writeFileSync(
      join(root, PATHS.COMPILED_RULES),
      JSON.stringify({ rules: [{ rule_id: 'RULE-9', trigger_patterns: ['src/utils/dates.ts'] }] }),
      'utf8',
    );
    seedIndex([{ path: 'src/utils/dates.ts', caller_count: 3 }]);

    expect(
      assembleDecisionEvidence({
        projectRoot: root,
        file: 'src/utils/dates.ts',
        category: 'create-vs-reuse',
        similarity: 0.9,
      }).rule_match,
    ).toBe('RULE-9');
  });

  it('falls back to the tree walk for a file the index does not know', () => {
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src/other.ts'), 'export const a = 1;\n', 'utf8');
    seedIndex([{ path: 'src/utils/dates.ts', caller_count: 12 }]);

    // Unknown to the index ⇒ counted by the walk (itself only), never reported as 12.
    expect(
      assembleDecisionEvidence({
        projectRoot: root,
        file: 'src/other.ts',
        category: 'create-vs-reuse',
        similarity: 0.9,
      }).callers,
    ).toBe(1);
  });

  it('derives similarity from the indexed caller count when none is supplied', () => {
    mkdirSync(join(root, 'src/utils'), { recursive: true });
    writeFileSync(join(root, 'src/utils/dates.ts'), 'export const a = 1;\n', 'utf8');
    seedIndex([{ path: 'src/utils/dates.ts', caller_count: 7 }]);

    expect(
      assembleDecisionEvidence({
        projectRoot: root,
        file: 'src/utils/dates.ts',
        category: 'create-vs-reuse',
      }).similarity,
    ).toBe(defaultSimilarityFor('create-vs-reuse', true, 7));
  });
});
