import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ProofType } from '@/core/types/planning.js';
import { featureFilePath } from '@/feature-evidence/paths.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import { persistLedgerSessionId } from '@/rag-ledger/session.js';
import { startStage } from '@/stage-evidence/recorder.js';

export interface CriterionSeed {
  id: string;
  proof: ProofType;
}

export function openChange(
  root: string,
  session: string,
  lane: 'fast' | 'graduated' | 'full' = 'full',
  title = 'ORD-501 CSV export',
): string {
  const dir = openFeatureChange(root, session, {
    adapter: 'claude-code',
    title,
    issue: title.split(' ')[0]!,
    lane,
  });
  persistLedgerSessionId(root, session);
  startStage(root, 'planning', { sessionId: session, dirName: dir, adapter: 'claude-code' });
  return dir;
}

export function writeSpec(
  root: string,
  dir: string,
  criteria: CriterionSeed[],
  frozen = true,
): void {
  const spec = {
    spec_id: 'S-1',
    spec_file: '.paqad/specs/S-1.md',
    spec_hash: 'h',
    behaviour: ['it works'],
    acceptance_criteria: criteria.map(({ id, proof }) => ({
      criterion_id: id,
      given: `a ${id} setup`,
      when: 'it runs',
      then: 'it holds',
      proof_type: proof,
      status: 'uncovered',
      source: 'planned',
      linked_requirement_ids: [],
    })),
    invariants: [],
    open_questions: [],
    frozen: frozen
      ? { frozen_at: '2026-10-19T00:00:00.000Z', spec_hash: 'h', signed_off_by: 'tester' }
      : null,
  };
  writeFileSync(join(root, featureFilePath(dir, 'specification')), JSON.stringify(spec));
}
