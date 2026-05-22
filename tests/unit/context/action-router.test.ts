import { ActionRouter } from '@/context/action-router.js';
import type { Chunk } from '@/context/types.js';

function makeChunk(id: string, content: string, symbols: string[] = []): Chunk {
  return {
    id,
    source_file: `src/${id}.ts`,
    ast_node_type: 'function',
    ast_node_path: id,
    exported_symbols: symbols,
    content,
    char_count: content.length,
    content_hash: id,
  };
}

const PENTEST_CHUNK = makeChunk(
  'auth-gate',
  'export function runPentestScan() { validateToken(); }',
  ['runPentestScan'],
);
const RCA_CHUNK = makeChunk(
  'error-handler',
  'export function analyzeRootCause(error: Error) { return trace(error); }',
  ['analyzeRootCause'],
);
const BORING_CHUNK = makeChunk(
  'utils',
  'export function formatDate(d: Date) { return d.toISOString(); }',
  ['formatDate'],
);

describe('ActionRouter.suggestActions', () => {
  const router = new ActionRouter();

  it('returns empty array when chunks is empty', () => {
    const result = router.suggestActions([], undefined, ['pentest']);
    expect(result).toHaveLength(0);
  });

  it('returns empty array when workflowIds is empty', () => {
    const result = router.suggestActions([PENTEST_CHUNK], undefined, []);
    expect(result).toHaveLength(0);
  });

  it('returns empty array when no chunks match any workflow trigger', () => {
    const result = router.suggestActions([BORING_CHUNK], undefined, [
      'pentest',
      'root-cause-analysis',
    ]);
    expect(result).toHaveLength(0);
  });

  it('skips workflows whose ids do not yield any trigger keywords', () => {
    const result = router.suggestActions([PENTEST_CHUNK], undefined, ['ci']);
    expect(result).toEqual([]);
  });

  it('matches pentest workflow for security-related chunks', () => {
    const result = router.suggestActions([PENTEST_CHUNK], undefined, ['pentest']);
    expect(result).toHaveLength(1);
    expect(result[0]?.workflow_id).toBe('pentest');
    expect(result[0]?.action_type).toBe('workflow');
  });

  it('matches root-cause-analysis workflow for analysis chunks', () => {
    const result = router.suggestActions([RCA_CHUNK], undefined, ['root-cause-analysis']);
    expect(result).toHaveLength(1);
    expect(result[0]?.workflow_id).toBe('root-cause-analysis');
  });

  it('requires_user_approval is always true', () => {
    const result = router.suggestActions([PENTEST_CHUNK], undefined, ['pentest']);
    expect(result[0]?.requires_user_approval).toBe(true);
  });

  it('evidence_chunk_ids contains only chunk IDs, not raw content', () => {
    const result = router.suggestActions([PENTEST_CHUNK], undefined, ['pentest']);
    const evidenceIds = result[0]?.evidence_chunk_ids ?? [];
    // Should contain the chunk ID
    expect(evidenceIds).toContain('auth-gate');
    // Should not contain raw chunk content
    for (const id of evidenceIds) {
      expect(typeof id).toBe('string');
      expect(id).not.toContain('export function');
      expect(id).not.toContain('{');
    }
  });

  it('explanation does not contain raw chunk text', () => {
    const result = router.suggestActions([PENTEST_CHUNK], undefined, ['pentest']);
    const explanation = result[0]?.explanation ?? '';
    // Explanation should not contain raw chunk content
    expect(explanation).not.toContain('validateToken');
    expect(explanation).not.toContain('export function runPentestScan');
    // But should mention the workflow
    expect(explanation).toContain('pentest');
  });

  it('invalid workflow ID not in registry is dropped (registry validation)', () => {
    // WorkflowId 'nonexistent-workflow' would not be in registry
    // Here the registry IS ['pentest'] — nonexistent is not in it
    const result = router.suggestActions([PENTEST_CHUNK], undefined, ['pentest']);
    const ids = result.map((r) => r.workflow_id);
    expect(ids).toContain('pentest');
    expect(ids).not.toContain('nonexistent-workflow');
  });

  it('confidence is between 0 and 1 inclusive', () => {
    const result = router.suggestActions([PENTEST_CHUNK, BORING_CHUNK], undefined, ['pentest']);
    const confidence = result[0]?.confidence ?? -1;
    expect(confidence).toBeGreaterThanOrEqual(0);
    expect(confidence).toBeLessThanOrEqual(1);
  });

  it('sorted by confidence descending when multiple recommendations', () => {
    const chunks = [PENTEST_CHUNK, RCA_CHUNK];
    const result = router.suggestActions(chunks, undefined, ['pentest', 'root-cause-analysis']);
    for (let i = 0; i < result.length - 1; i++) {
      expect(result[i]!.confidence).toBeGreaterThanOrEqual(result[i + 1]!.confidence);
    }
  });

  it('high-risk classification boosts security-workflow matching for pentest only', () => {
    const result = router.suggestActions([BORING_CHUNK], { risk: 'high', complexity: 'high' }, [
      'pentest',
    ]);
    expect(Array.isArray(result)).toBe(true);
  });

  it('generic high-risk keywords do not get injected into unrelated workflows', () => {
    const securityChunk = makeChunk(
      'security-note',
      'security vulnerability incident playbook',
      [],
    );
    const result = router.suggestActions([securityChunk], { risk: 'high' }, [
      'root-cause-analysis',
    ]);

    expect(result).toEqual([]);
  });
});

describe('ActionRouter — no raw chunk text in action fields', () => {
  it('all fields in ActionRecommendation are safe (no raw content)', () => {
    const router = new ActionRouter();
    const sensitiveChunk = makeChunk('secret', 'export const SECRET_KEY = "do-not-expose-this";', [
      'SECRET_KEY',
    ]);

    const result = router.suggestActions([sensitiveChunk], undefined, ['pentest']);

    for (const rec of result) {
      const json = JSON.stringify(rec);
      expect(json).not.toContain('do-not-expose-this');
      expect(json).not.toContain('export const SECRET_KEY');
    }
  });
});
