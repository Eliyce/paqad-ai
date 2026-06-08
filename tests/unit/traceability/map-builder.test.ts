import { describe, expect, it } from 'vitest';

import { buildTraceabilityMap } from '@/traceability/map-builder.js';
import type { BuildTraceabilityMapInput } from '@/core/types/traceability.js';

const NOW = () => '2026-06-08T00:00:00.000Z';

function baseInput(overrides: Partial<BuildTraceabilityMapInput> = {}): BuildTraceabilityMapInput {
  return {
    lane: 'graduated',
    now: NOW,
    promises: [],
    delivery: [],
    proofs: [],
    edges: [],
    codeUniverse: [],
    ...overrides,
  };
}

describe('buildTraceabilityMap — forward map + untested promise', () => {
  it('links a promise to delivering code and a proving check', () => {
    const map = buildTraceabilityMap(
      baseInput({
        promises: [
          { promise_id: 'AC-1', description: 'login works', source: 'acceptance-criterion' },
        ],
        delivery: [{ promise_id: 'AC-1', files: ['src/login.ts'] }],
        proofs: [{ promise_id: 'AC-1', checks: ['tests/login.test.ts'] }],
        codeUniverse: ['src/login.ts'],
      }),
    );

    const forward = map.forward.find((f) => f.promise_id === 'AC-1');
    expect(forward).toMatchObject({
      delivering_code: ['src/login.ts'],
      proving_checks: ['tests/login.test.ts'],
      proven: true,
    });
    expect(map.findings).toHaveLength(0);
  });

  it('flags a promise with no proving check', () => {
    const map = buildTraceabilityMap(
      baseInput({
        promises: [
          { promise_id: 'AC-2', description: 'logout works', source: 'acceptance-criterion' },
        ],
        delivery: [{ promise_id: 'AC-2', files: ['src/logout.ts'] }],
        proofs: [],
        codeUniverse: ['src/logout.ts'],
      }),
    );

    const untested = map.findings.filter((f) => f.code === 'TR-UNTESTED-PROMISE');
    expect(untested).toHaveLength(1);
    expect(untested[0]).toMatchObject({ promise_id: 'AC-2', paths: ['src/logout.ts'] });
    expect(map.counts.untested_promises).toBe(1);
  });
});

describe('buildTraceabilityMap — backward map + orphan code', () => {
  it('flags code with no promise and no user, but passes shared groundwork used by a promise', () => {
    const map = buildTraceabilityMap(
      baseInput({
        promises: [{ promise_id: 'AC-1', description: 'feature', source: 'acceptance-criterion' }],
        delivery: [{ promise_id: 'AC-1', files: ['src/feature.ts'] }],
        proofs: [{ promise_id: 'AC-1', checks: ['tests/feature.test.ts'] }],
        // feature imports a genuine shared util; dead.ts is used by nothing.
        edges: [{ from: 'src/feature.ts', to: 'src/shared-util.ts' }],
        codeUniverse: ['src/feature.ts', 'src/shared-util.ts', 'src/dead.ts'],
      }),
    );

    const roles = Object.fromEntries(map.backward.map((b) => [b.file, b.role]));
    expect(roles['src/feature.ts']).toBe('delivers-promise');
    expect(roles['src/shared-util.ts']).toBe('shared-groundwork');
    expect(roles['src/dead.ts']).toBe('orphan');

    const orphans = map.findings.filter((f) => f.code === 'TR-CODE-ORPHAN');
    expect(orphans.map((f) => f.paths[0])).toEqual(['src/dead.ts']);
    expect(map.counts.orphan_code).toBe(1);
    expect(map.counts.shared_groundwork).toBe(1);
  });

  it('decides by dependency, not a label — a "this is fine" comment cannot suppress a dead flag', () => {
    // The builder only sees edges + anchors; file *content* never reaches it,
    // so an in-file "this is fine" note has no effect. We model that by giving
    // the dead file no inbound edge from any anchor regardless of any comment.
    const map = buildTraceabilityMap(
      baseInput({
        promises: [{ promise_id: 'AC-1', description: 'feature', source: 'acceptance-criterion' }],
        delivery: [{ promise_id: 'AC-1', files: ['src/feature.ts'] }],
        proofs: [{ promise_id: 'AC-1', checks: ['tests/feature.test.ts'] }],
        edges: [],
        codeUniverse: ['src/feature.ts', 'src/blessed-but-dead.ts'],
      }),
    );

    const orphans = map.findings.filter((f) => f.code === 'TR-CODE-ORPHAN');
    expect(orphans.map((f) => f.paths[0])).toEqual(['src/blessed-but-dead.ts']);
  });

  it('counts a marker-delivered file as a promise anchor (reuse, not fork)', () => {
    const map = buildTraceabilityMap(
      baseInput({
        promises: [{ promise_id: 'AC-9', description: 'marked', source: 'obligation' }],
        delivery: [],
        markers: [{ file: 'src/marked.ts', promise_ids: ['AC-9'] }],
        proofs: [{ promise_id: 'AC-9', checks: ['tests/marked.test.ts'] }],
        codeUniverse: ['src/marked.ts'],
      }),
    );

    const backward = map.backward.find((b) => b.file === 'src/marked.ts');
    expect(backward).toMatchObject({ promise_ids: ['AC-9'], role: 'delivers-promise' });
  });
});

describe('buildTraceabilityMap — anchors unknown', () => {
  it('suppresses orphan flagging when no promise anchors are discoverable', () => {
    const map = buildTraceabilityMap(
      baseInput({
        promises: [],
        codeUniverse: ['src/a.ts', 'src/b.ts'],
        edges: [],
      }),
    );

    expect(map.anchors_known).toBe(false);
    expect(map.blocked_reason).toBe('no_promises_discovered');
    expect(map.findings.filter((f) => f.code === 'TR-CODE-ORPHAN')).toHaveLength(0);
  });
});

describe('buildTraceabilityMap — lane behaviour', () => {
  it('fast lane restricts orphan flagging to the change set (light subset)', () => {
    const input = baseInput({
      lane: 'fast',
      promises: [{ promise_id: 'AC-1', description: 'feature', source: 'acceptance-criterion' }],
      delivery: [{ promise_id: 'AC-1', files: ['src/feature.ts'] }],
      proofs: [{ promise_id: 'AC-1', checks: ['tests/feature.test.ts'] }],
      edges: [],
      codeUniverse: ['src/feature.ts', 'src/old-dead.ts', 'src/new-dead.ts'],
      changedFiles: ['src/new-dead.ts'],
    });
    const map = buildTraceabilityMap(input);

    expect(map.mode).toBe('light');
    const orphans = map.findings.filter((f) => f.code === 'TR-CODE-ORPHAN');
    // Only the newly-changed dead file is flagged; the pre-existing one is not.
    expect(orphans.map((f) => f.paths[0])).toEqual(['src/new-dead.ts']);
  });

  it('graduated/full lane runs the full build over the whole universe', () => {
    const map = buildTraceabilityMap(
      baseInput({
        lane: 'full',
        promises: [{ promise_id: 'AC-1', description: 'feature', source: 'acceptance-criterion' }],
        delivery: [{ promise_id: 'AC-1', files: ['src/feature.ts'] }],
        proofs: [{ promise_id: 'AC-1', checks: ['tests/feature.test.ts'] }],
        codeUniverse: ['src/feature.ts', 'src/dead-a.ts', 'src/dead-b.ts'],
        changedFiles: ['src/dead-a.ts'],
      }),
    );

    expect(map.mode).toBe('full');
    const orphans = map.findings.filter((f) => f.code === 'TR-CODE-ORPHAN');
    // Full lane ignores changedFiles — both dead files are flagged.
    expect(orphans.map((f) => f.paths[0])).toEqual(['src/dead-a.ts', 'src/dead-b.ts']);
  });
});
