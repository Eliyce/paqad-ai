// Mutation-testing verification gate. Issue #105.
//
// Reads the mutation result the verification phase plants on the context and
// turns it into a pass / inconclusive / fail outcome that flows through the
// existing verification evidence — no parallel store.
//
// Open-decision resolutions (from the issue's recommendations):
//   1. Runs as a gate within the verification run (reuses evidence + wiring).
//   2. Survivors *escalate* (inconclusive) by default; a project-tunable strict
//      mode (`mutation_strict`) turns them into a hard block. This avoids
//      turning every survivor into a stop before baselines exist (#110 ratchet).
//   3. The `fast` lane skips mutation upstream → the gate passes (light).
//   4. Equivalent mutants are set aside by the tool and excluded from the bar.
//
// Safety is non-negotiable: if the working tree was not clean after the run
// (a mutant may have been left behind), the gate hard-fails regardless of mode.

import type { MutationResult } from '@/core/types/mutation.js';

import type { Gate } from './gate.interface.js';
import { createFail, createInconclusive, createPass } from './shared.js';

function summarizeSurvivors(result: MutationResult): string {
  const shown = result.surviving_mutants
    .slice(0, 5)
    .map((mutant) => `${mutant.file}:${mutant.line} (${mutant.operator})`)
    .join(', ');
  const extra =
    result.surviving_mutants.length > 5 ? `, +${result.surviving_mutants.length - 5} more` : '';
  return `${shown}${extra}`;
}

export class MutationTestingGate implements Gate {
  readonly gate = 'mutation-testing' as const;

  async check(context: Parameters<Gate['check']>[0]) {
    const result = context.mutation_result;

    // Nothing ran (gate not wired for this run, or mutation not applicable):
    // treat as a pass so the gate is inert when there is no signal.
    if (!result) {
      return createPass(this.gate, 'Mutation testing did not run; no signal to evaluate.');
    }

    if (result.status === 'skipped') {
      return createPass(
        this.gate,
        `Mutation testing skipped (${result.skipped_reason ?? 'unknown reason'}).`,
      );
    }

    // Safety: a dirty tree means a planted mutant may not have been removed.
    if (result.status === 'unsafe-tree') {
      return createFail(
        this.gate,
        `Working tree was not clean after the mutation run (${result.tool ?? 'mutation tool'}); a mutant may have been left behind.`,
        'Restore the tree to a clean state and re-run; mutation must always be fully reverted.',
      );
    }

    const killRate = result.kill_rate === null ? 'n/a' : `${result.kill_rate}%`;
    const counts = `killed ${result.killed}, survived ${result.survived}, set-aside ${result.equivalent_set_aside}`;

    // Weak-tooled language: present the result but never over-trust it.
    if (result.status === 'lower-confidence') {
      return createInconclusive(
        this.gate,
        `Mutation result is lower-confidence (${result.tool ?? result.language ?? 'best-available tool'}); kill rate ${killRate} (${counts}).`,
        'Treat this score as indicative only; a mature mutation tool is not available for this language.',
      );
    }

    if (result.status === 'survivors') {
      const detail = `${result.survived} behaviour-changing mutant(s) survived (kill rate ${killRate}): ${summarizeSurvivors(result)}.`;
      const remediation =
        'Strengthen the tests so each surviving mutant is caught, or confirm any genuinely equivalent.';
      return context.mutation_strict
        ? createFail(this.gate, detail, remediation)
        : createInconclusive(this.gate, detail, remediation);
    }

    return createPass(
      this.gate,
      `Every behaviour-changing mutant was killed (kill rate ${killRate}; ${counts}).`,
    );
  }
}
