import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { moveBaselineToRun } from './baseline.js';
import { readFromDecisions } from './decisions.js';
import { readJsonFile } from './files.js';
import { absRunFile } from './paths.js';
import {
  buildProposal,
  carryVerdicts,
  isNothingToPropose,
  readExistingRules,
  readJudgements,
  readProposal,
  ruleFileHash,
  rowsWithoutVerdict,
  setVerdict,
  signoffCounts,
  staleRows,
  writeProposal,
  type Proposal,
  type Verdict,
} from './proposal.js';
import { readResearchFiles } from './research.js';
import { readRun, updateRun, type RunPatch, type RunRecord } from './run-store.js';
import { openSignoffDecision } from './signoff.js';
import { sha256Text } from './text.js';
import type { StackInventory } from './types.js';

export function readInventoryFile(projectRoot: string, runId: string): StackInventory | null {
  const read = readJsonFile<StackInventory>(absRunFile(projectRoot, runId, 'inventory'));
  return read.state === 'ok' ? read.value : null;
}

export function manifestHashes(
  projectRoot: string,
  paths: readonly string[],
): Record<string, string> {
  const hashes: Record<string, string> = {};
  for (const path of paths) {
    try {
      hashes[path] = sha256Text(readFileSync(join(projectRoot, path), 'utf8'));
    } catch {
      hashes[path] = 'missing';
    }
  }
  return hashes;
}

export function advanceRun(
  projectRoot: string,
  runId: string,
  patch: RunPatch,
  expectedRevision?: number,
  now: Date = new Date(),
): RunRecord {
  const read = readRun(projectRoot, runId);
  if (read.state !== 'ok') {
    throw new Error(
      `run ${runId} has a ${read.state} run.json; say "discover rules" and choose start fresh`,
    );
  }
  const result = updateRun(
    projectRoot,
    runId,
    expectedRevision ?? read.record.revision,
    patch,
    now,
  );
  if (!result.ok) {
    throw new Error(`${result.detail}; say "discover rules" and choose start fresh`);
  }
  return result.record;
}

export interface ProposeResult {
  proposal: Proposal;
  stale: Array<{ row_id: string; why: string }>;
  current: boolean;
}

export function proposeStep(
  projectRoot: string,
  runId: string,
  now: Date = new Date(),
  expectedRevision?: number,
): ProposeResult {
  const inventory = readInventoryFile(projectRoot, runId);
  const existing = readExistingRules(projectRoot);
  const fileHash = (rel: string): string | null => ruleFileHash(projectRoot, rel);
  const manifests = manifestHashes(projectRoot, inventory?.manifests ?? []);
  const built = buildProposal({
    runId,
    now,
    existing,
    decisions: readFromDecisions(projectRoot, runId),
    research: readResearchFiles(projectRoot, runId).ideas,
    inventory,
    judgements: readJudgements(projectRoot, runId),
    fileHash,
    manifests,
  });
  const previous = readProposal(projectRoot, runId);
  const stale = previous === null ? [] : staleRows(previous, existing, fileHash, manifests);
  const proposal = previous === null ? built : carryVerdicts(previous, built);
  if (isNothingToPropose(proposal)) {
    writeProposal(projectRoot, proposal);
    if (inventory !== null) moveBaselineToRun(projectRoot, inventory, now);
    advanceRun(projectRoot, runId, { step: 'done', status: 'done' }, expectedRevision, now);
    return { proposal, stale, current: true };
  }
  writeProposal(projectRoot, proposal);
  advanceRun(projectRoot, runId, { step: 'propose' }, expectedRevision, now);
  return { proposal, stale, current: false };
}

export function reviewStep(
  projectRoot: string,
  runId: string,
  rowId: string,
  verdict: Verdict,
  editedText?: string,
): Proposal {
  const proposal = readProposal(projectRoot, runId);
  if (proposal === null) throw new Error(`run ${runId} has no proposal yet`);
  const next = setVerdict(proposal, rowId, verdict, editedText);
  writeProposal(projectRoot, next);
  return next;
}

export interface SignoffResult {
  decision_id: string;
  hash: string;
  counts: ReturnType<typeof signoffCounts>;
}

export function signoffStep(
  projectRoot: string,
  runId: string,
  now: Date = new Date(),
  expectedRevision?: number,
): SignoffResult {
  const proposal = readProposal(projectRoot, runId);
  if (proposal === null) throw new Error(`run ${runId} has no proposal yet`);
  const open = rowsWithoutVerdict(proposal);
  if (open.length > 0) {
    throw new Error(`rows without a keep, edit or drop verdict: ${open.join(', ')}`);
  }
  const hash = writeProposal(projectRoot, proposal);
  const decisionId = openSignoffDecision(projectRoot, proposal, hash, now);
  advanceRun(
    projectRoot,
    runId,
    { step: 'sign_off', signoff_decision: decisionId, proposal_hash: hash },
    expectedRevision,
    now,
  );
  return { decision_id: decisionId, hash, counts: signoffCounts(proposal) };
}
