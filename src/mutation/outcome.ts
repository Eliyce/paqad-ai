// Mutation kill-rate maths. Issue #105.
//
// The bar (Settled): kill every mutant that could change behaviour; equivalent
// mutants are set aside and do not count. We therefore compute:
//   killed      = killed + timeout            (the mutant was caught)
//   survived    = survived + no-coverage      (behaviour change went unnoticed)
//   set aside   = equivalent + error          (excluded from the bar/denominator)
//   kill_rate   = killed / (killed + survived)
//
// Confidence is decided by the adapter (mature tool vs weak-tooled language),
// not here. The tree-clean safety check is decided by the runner. This module
// is pure so the maths and the bar are independently testable.

import type {
  MutationConfidence,
  MutationGateStatus,
  MutationResult,
  RawMutant,
  SurvivingMutant,
} from '@/core/types/mutation.js';

const KILLED_STATUSES = new Set(['killed', 'timeout']);
const SURVIVOR_STATUSES = new Set(['survived', 'no-coverage']);
const SET_ASIDE_STATUSES = new Set(['equivalent', 'error']);

export interface MutationOutcomeInput {
  mutants: RawMutant[];
  confidence: MutationConfidence;
  tree_clean: boolean;
  scoped_files: string[];
  tool: string | null;
  language: string | null;
}

function toSurvivor(mutant: RawMutant): SurvivingMutant {
  return {
    file: mutant.file,
    line: mutant.line,
    operator: mutant.operator,
    ...(mutant.description ? { description: mutant.description } : {}),
  };
}

function deriveStatus(input: {
  treeClean: boolean;
  confidence: MutationConfidence;
  survivors: number;
}): MutationGateStatus {
  // Safety beats everything: a dirty tree may mean mutants were left behind.
  if (!input.treeClean) {
    return 'unsafe-tree';
  }
  if (input.survivors > 0) {
    return 'survivors';
  }
  // No survivors, but a weak-tooled language → the clean result is still only
  // lower-confidence.
  if (input.confidence === 'lower') {
    return 'lower-confidence';
  }
  return 'killed-all';
}

/**
 * Compute the mutation result from a tool's normalised mutants. Equivalent and
 * errored mutants are excluded from both the survivor list and the denominator.
 */
export function computeMutationOutcome(input: MutationOutcomeInput): MutationResult {
  let killed = 0;
  let survived = 0;
  let setAside = 0;
  const survivingMutants: SurvivingMutant[] = [];

  for (const mutant of input.mutants) {
    if (KILLED_STATUSES.has(mutant.status)) {
      killed += 1;
    } else if (SURVIVOR_STATUSES.has(mutant.status)) {
      survived += 1;
      survivingMutants.push(toSurvivor(mutant));
    } else if (SET_ASIDE_STATUSES.has(mutant.status)) {
      setAside += 1;
    }
  }

  const eligible = killed + survived;
  const killRate = eligible === 0 ? null : Math.round((killed / eligible) * 100 * 100) / 100;
  const status = deriveStatus({
    treeClean: input.tree_clean,
    confidence: input.confidence,
    survivors: survived,
  });

  return {
    tool: input.tool,
    language: input.language,
    confidence: input.confidence,
    scoped_files: [...input.scoped_files].sort(),
    total_mutants: input.mutants.length,
    killed,
    survived,
    equivalent_set_aside: setAside,
    kill_rate: killRate,
    surviving_mutants: survivingMutants.sort(
      (a, b) => a.file.localeCompare(b.file) || a.line - b.line,
    ),
    tree_clean: input.tree_clean,
    status,
    skipped_reason: null,
  };
}
