import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import type { CodeKnowledgeIndex, CodeKnowledgeReferenceEdge } from '@/code-knowledge/types.js';
import type { DuplicationFinding } from '@/duplication/types.js';
import type { DuplicationReport } from '@/duplication/report.js';

export function makeProject(): string {
  return mkdtempSync(join(tmpdir(), 'paqad-metrics-'));
}

export function writeFile(root: string, relPath: string, content: string): void {
  const abs = join(root, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, 'utf8');
}

export function codeLines(count: number): string {
  return Array.from({ length: count }, (_, i) => `const x${i} = ${i};`).join('\n');
}

export function finding(file: string, start: number, end: number): DuplicationFinding {
  return {
    file,
    line_range: { start, end },
    matched_file: 'src/existing.ts',
    matched_line_range: { start: 1, end: end - start + 1 },
    similarity: 0.95,
    matched_callers: 3,
    corroborated: false,
    kind: 'deterministic',
    message: 'near-copy',
  };
}

export function writeDuplicationCache(root: string, findings: DuplicationFinding[]): void {
  const report: DuplicationReport = {
    schema_version: 1,
    generated_at: 'x',
    mode: 'strict',
    similarity_threshold: 0.9,
    min_lines: 8,
    elapsed_ms: 1,
    findings,
    counts: { deterministic: findings.length, heuristic: 0 },
    blocking: findings.length > 0,
  };
  writeFile(root, PATHS.DUPLICATION_REPORT, JSON.stringify(report));
}

export function writeIndex(root: string, referenceEdges: CodeKnowledgeReferenceEdge[]): void {
  const index: CodeKnowledgeIndex = {
    schema_version: 1,
    header: {
      generated_at: 'x',
      branch: null,
      head_commit: null,
      schema_version: 1,
      entry_point_globs: [],
    },
    symbols: [],
    files: [],
    import_edges: [],
    reference_edges: referenceEdges,
    dependencies: [],
  };
  writeFile(root, PATHS.CODE_KNOWLEDGE_INDEX, JSON.stringify(index));
}
