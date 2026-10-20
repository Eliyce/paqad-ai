import type { MutationResult, MutationSkipReason } from '@/core/types/mutation.js';
import type { GateSkipKind } from '@/core/types/verification.js';

import type { Gate } from './gate.interface.js';
import {
  createDidNotRun,
  createFail,
  createInconclusive,
  createNotRequired,
  createPass,
} from './shared.js';

export const MUTATION_OFF_DETAIL = 'Mutation testing is off (mutation_mode is off).';

interface SkipReading {
  kind: GateSkipKind;
  words: string;
  remediation?: string;
}

const SKIP_READING: Record<MutationSkipReason, SkipReading> = {
  'fast-lane': {
    kind: 'not-required',
    words: 'Mutation testing is not required on the fast lane.',
  },
  'no-changed-code': {
    kind: 'not-required',
    words: 'Mutation testing is not required: no code changed.',
  },
  'tests-not-green': {
    kind: 'did-not-run',
    words: 'Mutation testing did not run: the test command was not green to begin with.',
    remediation: 'Make the test command pass, then run verification again.',
  },
  'no-test-command': {
    kind: 'did-not-run',
    words:
      'Mutation testing did not run: no test command is configured, so nothing proved the suite green first.',
    remediation:
      'Set commands.test in .paqad/project-profile.yaml to the project test command, or set mutation_mode=off.',
  },
  'tool-not-configured': {
    kind: 'did-not-run',
    words: 'Mutation testing did not run: no mutation tool is configured for this stack.',
    remediation:
      'Install the mutation tool for this stack in the project, or set mutation_mode=off.',
  },
  'run-failed': {
    kind: 'did-not-run',
    words: 'Mutation testing did not run: the mutation tool failed before it produced a result.',
    remediation: 'Check the mutation tool output, fix what stopped it, and run verification again.',
  },
};

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

    if (!result) {
      return createNotRequired(this.gate, context.mutation_note ?? MUTATION_OFF_DETAIL);
    }

    if (result.status === 'skipped') {
      const reading = result.skipped_reason ? SKIP_READING[result.skipped_reason] : undefined;
      if (!reading) {
        return createDidNotRun(
          this.gate,
          `Mutation testing did not run (${result.skipped_reason ?? 'no reason recorded'}).`,
        );
      }
      return reading.kind === 'not-required'
        ? createNotRequired(this.gate, reading.words)
        : createDidNotRun(this.gate, reading.words, reading.remediation);
    }

    if (result.status === 'unsafe-tree') {
      return createFail(
        this.gate,
        `Working tree was not clean after the mutation run (${result.tool ?? 'mutation tool'}); a mutant may have been left behind.`,
        'Restore the tree to a clean state and re-run; mutation must always be fully reverted.',
      );
    }

    const killRate = result.kill_rate === null ? 'n/a' : `${result.kill_rate}%`;
    const counts = `killed ${result.killed}, survived ${result.survived}, set-aside ${result.equivalent_set_aside}`;

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
