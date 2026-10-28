import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { featureChangeKey } from '@/feature-evidence/paths.js';

import { readContractDecisions, resolvePendingDecision } from '@/decisions/authoring.js';
import { mintExpertConflictDecisions } from '@/spec-pipeline/experts/conflicts.js';
import type { SynthesisConflict } from '@/spec-pipeline/experts/synthesis.js';
import type { MergedExpertNotes } from '@/spec-pipeline/experts/types.js';

const roots: string[] = [];
function tempRoot(): string {
  const r = mkdtempSync(join(tmpdir(), 'paqad-conflicts-'));
  roots.push(r);
  return r;
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

const merged: MergedExpertNotes = {
  findings: [],
  conflicts: [
    {
      target: 'orders',
      roles: ['db-expert', 'performance-analyst'],
      claims: ['stream the CSV in pages', 'generate in a background job'],
      finding_ids: ['EX-db-expert-1', 'EX-performance-analyst-1'],
    },
  ],
};
const synthesisConflicts: SynthesisConflict[] = [
  {
    target: 'orders',
    recommendation: 'generate in a background job',
    rationale: 'a bulk export is slow',
  },
];

function pending(root: string) {
  return readContractDecisions(root).filter((row) => row.status === 'pending');
}

describe('mintExpertConflictDecisions', () => {
  it('mints exactly one spec.expert_conflict packet per conflict, with the chief pick pre-filled', () => {
    const root = tempRoot();
    const result = mintExpertConflictDecisions(root, merged, synthesisConflicts);
    expect(result.minted).toHaveLength(1);
    expect(result.autoResolved).toEqual([]);
    const packets = pending(root);
    expect(packets).toHaveLength(1);
    const packet = packets[0]!.packet;
    expect(packet.category).toBe('spec.expert_conflict');
    expect(packet.title).toBe('Experts disagree on orders');
    expect(packet.origin).toBe('expert-conflict');
    expect(packet.options).toHaveLength(2);
    expect(packet.options.map((o) => o.label)).toEqual([
      'stream the CSV in pages — db-expert',
      'generate in a background job — performance-analyst',
    ]);
    const recommended = packet.options.find((o) => o.option_key === packet.recommendation);
    expect(recommended?.label).toContain('generate in a background job');
    expect(packet.context).toMatch(/\[expert-conflict-fork:[0-9a-f]{16}\]/);
    expect((packet as unknown as { change?: string }).change).toBeUndefined();
  });

  it('stamps the change id from the bundle dir, so the HUD shows the packet', () => {
    const root = tempRoot();
    const dirName = 'export-orders-01M5JAC57SYAJ69SV5MZN8A40K';
    mintExpertConflictDecisions(root, merged, synthesisConflicts, dirName);
    const packet = pending(root)[0]!.packet as unknown as { change?: string };
    expect(packet.change).toBe(featureChangeKey(dirName));
  });

  it('reuses an identical resolved fork instead of minting again (FR-6.3)', () => {
    const root = tempRoot();
    const first = mintExpertConflictDecisions(root, merged, synthesisConflicts);
    const id = first.minted[0]!.id;
    const packet = pending(root)[0]!.packet;
    const chosenKey = packet.options[1]!.option_key;
    resolvePendingDecision(root, id, chosenKey, 'go async');

    const second = mintExpertConflictDecisions(root, merged, synthesisConflicts);
    expect(second.minted).toEqual([]);
    expect(second.autoResolved).toEqual([
      {
        target: 'orders',
        chosen: 'generate in a background job — performance-analyst',
        source: id,
      },
    ]);
    expect(pending(root)).toHaveLength(0);
  });

  it('mints with a null recommendation when the chief did not recommend for that target', () => {
    const root = tempRoot();
    const result = mintExpertConflictDecisions(root, merged, []);
    expect(result.minted).toHaveLength(1);
    expect(pending(root)[0]!.packet.recommendation).toBeNull();
  });

  it('mints nothing for a merge with no conflicts', () => {
    const root = tempRoot();
    const result = mintExpertConflictDecisions(root, { findings: [], conflicts: [] }, []);
    expect(result).toEqual({ minted: [], autoResolved: [] });
    expect(pending(root)).toEqual([]);
  });
});

describe('mintExpertConflictDecisions edge branches', () => {
  it('dedupes option keys derived from claims that slug the same, and tolerates a short roles array', () => {
    const merged2: MergedExpertNotes = {
      findings: [],
      conflicts: [
        {
          target: 'orders',
          roles: ['db-expert'],
          claims: ['Stream it!', 'stream it'],
          finding_ids: [],
        },
      ],
    };
    const root = tempRoot();
    const result = mintExpertConflictDecisions(root, merged2, []);
    expect(result.minted).toHaveLength(1);
    const packet = pending(root)[0]!.packet;
    expect(new Set(packet.options.map((o) => o.option_key)).size).toBe(2);
    expect(packet.options[1]!.label).toContain('unknown');
  });
});

describe('mintExpertConflictDecisions rulings and duplicates', () => {
  function pendingFiles(root: string): string[] {
    const dir = join(root, '.paqad', 'decisions', 'pending');
    return existsSync(dir) ? readdirSync(dir) : [];
  }

  it('AC-5: re-running with the same fork pending mints nothing and leaves the pending count unchanged', () => {
    const root = tempRoot();
    const dirName = 'export-orders-01M5JAC57SYAJ69SV5MZN8A40K';
    const first = mintExpertConflictDecisions(root, merged, synthesisConflicts, dirName);
    expect(first.minted).toHaveLength(1);
    const before = pendingFiles(root);
    expect(before).toHaveLength(1);

    const second = mintExpertConflictDecisions(root, merged, synthesisConflicts, dirName);
    expect(second).toEqual({ minted: [], autoResolved: [] });
    expect(pendingFiles(root)).toEqual(before);
  });

  it('AC-5: a compatible ruling mints nothing and a pick mints exactly one', () => {
    const root = tempRoot();
    const compatible = mintExpertConflictDecisions(root, merged, [
      {
        target: 'orders',
        ruling: 'compatible',
        merged_claim: 'stream in pages from a background job',
        rationale: 'both hold',
      },
    ]);
    expect(compatible).toEqual({ minted: [], autoResolved: [] });
    expect(pendingFiles(root)).toEqual([]);

    const pick = mintExpertConflictDecisions(root, merged, [
      { ...synthesisConflicts[0]!, ruling: 'pick' },
    ]);
    expect(pick.minted).toHaveLength(1);
    expect(pendingFiles(root)).toHaveLength(1);
  });
});
