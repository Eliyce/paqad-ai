import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { writeCodeKnowledgeIndex } from '@/code-knowledge/store.js';
import { CODE_KNOWLEDGE_SCHEMA_VERSION } from '@/code-knowledge/types.js';
import { runSpecCodeCheck, specCodeCheckLive } from '@/spec-pipeline/spec-code-check.js';
import type { FeatureSpec } from '@/core/types/feature-spec.js';
import type { TraceArtifact } from '@/spec-pipeline/trace.js';

const roots: string[] = [];
function tempRoot(): string {
  const r = mkdtempSync(join(tmpdir(), 'paqad-a5-'));
  roots.push(r);
  return r;
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function spec(): FeatureSpec {
  return {
    schema_version: '1',
    spec_id: 'S-a5',
    spec_file: '.paqad/_specs/S-a5.md',
    spec_hash: 'a'.repeat(64),
    behaviour: ['FR-1: x'],
    acceptance_criteria: [
      {
        criterion_id: 'AC-1',
        given: 'a',
        when: 'b',
        then: 'c',
        proof_type: 'automated',
        status: 'uncovered',
        source: 'planned',
        linked_requirement_ids: [],
      },
    ],
    invariants: [
      { invariant_id: 'INV-1', statement: 'never', source: 'authored', confirmed: true },
    ],
    open_questions: [],
    frozen: { frozen_at: '2026-09-04T00:00:00Z', spec_hash: 'a'.repeat(64), signed_off_by: 'h' },
  };
}

const fullTrace: TraceArtifact = {
  entries: [
    { id: 'AC-1', kind: 'AC', source: 'task.explicit_inclusions[0]' },
    { id: 'INV-1', kind: 'INV', source: 'answer:D-1' },
  ],
};

describe('specCodeCheckLive', () => {
  it('is false when no code-knowledge index exists', () => {
    expect(specCodeCheckLive(tempRoot())).toBe(false);
  });

  it('is true once a code-knowledge index is present', () => {
    const root = tempRoot();
    writeCodeKnowledgeIndex(root, {
      schema_version: CODE_KNOWLEDGE_SCHEMA_VERSION,
      header: {
        generated_at: '2026-09-04T00:00:00Z',
        branch: null,
        head_commit: null,
        schema_version: CODE_KNOWLEDGE_SCHEMA_VERSION,
        entry_point_globs: [],
      },
      symbols: [],
      files: [],
      import_edges: [],
      reference_edges: [],
      dependencies: [],
    });
    expect(specCodeCheckLive(root)).toBe(true);
  });
});

describe('runSpecCodeCheck', () => {
  it('aligned when every criterion/invariant is traced and the index is present', () => {
    const r = runSpecCodeCheck(spec(), fullTrace, true);
    expect(r.live).toBe(true);
    expect(r.verdict).toBe('aligned');
    expect(r.findings).toEqual([]);
  });

  it('needs-attention when a criterion is untraced', () => {
    const r = runSpecCodeCheck(
      spec(),
      { entries: [{ id: 'INV-1', kind: 'INV', source: 'x' }] },
      true,
    );
    expect(r.verdict).toBe('needs-attention');
    expect(r.findings.map((f) => f.requirement_id)).toContain('AC-1');
  });

  it('inconclusive (A5 not live) when no index is present', () => {
    const r = runSpecCodeCheck(spec(), fullTrace, false);
    expect(r.live).toBe(false);
    expect(r.verdict).toBe('inconclusive');
  });
});
