import {
  FORCED_FIX_LANES,
  type ForcedFixLane,
  type FlakyRegistry,
  type QuarantineDebt,
  type TouchGateResult,
} from '@/core/types/flaky.js';
import type { Lane } from '@/core/types/routing.js';

import { activeQuarantines } from './registry.js';
import { modulesForFiles } from './attribution.js';

function isForcedFixLane(lane: Lane): lane is ForcedFixLane {
  return (FORCED_FIX_LANES as readonly string[]).includes(lane);
}

export interface TouchGateInput {
  projectRoot: string;
  registry: FlakyRegistry;
  /** Files the current change touches (repo-relative). */
  changedFiles: string[];
  /** The routing lane of the current change. */
  lane: Lane;
}

/**
 * The forced-fix-on-touch gate (issue #106 §4). A quarantined test never blocks
 * unrelated progress — but the moment a change touches a module that owns a
 * quarantined test, fixing that test becomes part of the work. So a flake can be
 * set aside without being ignored forever.
 *
 * Lane behaviour mirrors the issue: cheap detection/quarantine runs on every lane
 * (a flaky failure must not block even a `fast` change), but this *forced-fix*
 * gate only bites on `graduated`/`full` — a trivial fast-lane change stays light.
 */
export function evaluateTouchGate(input: TouchGateInput): TouchGateResult {
  if (!isForcedFixLane(input.lane)) {
    return {
      blocked: false,
      touched_modules: [],
      debts: [],
      reason: 'fast-lane-skipped',
    };
  }

  const touched = new Set(modulesForFiles(input.projectRoot, input.changedFiles));
  if (touched.size === 0) {
    return { blocked: false, touched_modules: [], debts: [], reason: 'no-debt' };
  }

  const debts: QuarantineDebt[] = [];
  for (const entry of activeQuarantines(input.registry)) {
    for (const module of entry.modules) {
      if (touched.has(module)) {
        debts.push({
          test_id: entry.test_id,
          suite: entry.suite,
          module,
          suspected_causes: entry.suspected_causes,
        });
      }
    }
  }
  debts.sort((a, b) => a.module.localeCompare(b.module) || a.test_id.localeCompare(b.test_id));

  const touchedWithDebt = [...new Set(debts.map((d) => d.module))].sort();

  if (debts.length === 0) {
    return {
      blocked: false,
      touched_modules: [...touched].sort(),
      debts: [],
      reason: 'no-debt',
    };
  }

  return {
    blocked: true,
    touched_modules: touchedWithDebt,
    debts,
    reason: 'forced-fix',
  };
}
