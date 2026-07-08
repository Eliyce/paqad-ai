import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

import { Command } from 'commander';

import { buildFeatureSpec } from '@/spec/feature-spec-builder.js';
import { evaluateSpecFreeze, freezeSpec } from '@/spec/spec-freeze.js';
import { writeFrozenSpec } from '@/spec/frozen-spec-store.js';
import type { FeatureSpec } from '@/core/types/feature-spec.js';

/**
 * `paqad-ai spec freeze <spec-file>` — the shell escape hatch that activates the
 * built-but-dead spec sign-off engine (issue #317). The specification stage promises
 * a frozen, signed-off spec before a line of code, but nothing ever ran the machinery
 * in `src/spec/`: no CLI verb, no instruction naming it. This verb is that caller. It
 * is invocation only — it reimplements none of the freeze logic:
 *
 *   buildFeatureSpec → evaluateSpecFreeze → freezeSpec → writeFrozenSpec
 *
 * Blockers (missing behaviour / acceptance criteria / invariants, an acceptance
 * criterion with no proof target, an unconfirmed invariant, an open question) are
 * printed and the command exits non-zero with nothing frozen — a spec is never frozen
 * silently over unresolved questions. On a clean spec it writes the frozen sidecar at
 * `.paqad/specs/<spec_id>.frozen.json`, the durable record other stages check against.
 */
export function createSpecCommand(): Command {
  const command = new Command('spec').description(
    'Work with feature specifications (freeze the spec before code)',
  );

  command
    .command('freeze')
    .description('Freeze and sign off a feature spec, writing the frozen sidecar')
    .argument('<spec-file>', 'Path to the human-readable spec markdown')
    .option('--project-root <path>', 'Project root', process.cwd())
    .option(
      '--signed-off-by <name>',
      'Who is signing off the freeze (recorded in the frozen sidecar)',
      'unattributed',
    )
    .option(
      '--spec-id <id>',
      'Spec id for the sidecar filename (defaults to the spec file basename without extension)',
    )
    .option(
      '--confirm-invariants',
      'Confirm every invariant as part of this sign-off (the human freeze act)',
      false,
    )
    .action(
      (
        specFile: string,
        options: {
          projectRoot: string;
          signedOffBy: string;
          specId?: string;
          confirmInvariants: boolean;
        },
      ) => {
        let markdown: string;
        try {
          markdown = readFileSync(specFile, 'utf8');
        } catch {
          console.error(`could not read spec file "${specFile}"`);
          process.exitCode = 1;
          return;
        }

        const specId = options.specId ?? basename(specFile).replace(/\.[^.]+$/, '');
        const built = buildFeatureSpec({
          spec_id: specId,
          spec_file: specFile,
          spec_markdown: markdown,
        });

        // Confirming invariants IS the human sign-off act: the operator running this
        // verb with --confirm-invariants is affirming every invariant. Without the
        // flag, unconfirmed invariants stay blockers (honest — freeze is never implied).
        const spec: FeatureSpec = options.confirmInvariants
          ? { ...built, invariants: built.invariants.map((inv) => ({ ...inv, confirmed: true })) }
          : built;

        const evaluation = evaluateSpecFreeze(spec);
        if (!evaluation.can_freeze) {
          console.error(
            `**▸ paqad** · can't freeze this spec yet — ${evaluation.blockers.length} ` +
              `blocker${evaluation.blockers.length === 1 ? '' : 's'} to resolve:`,
          );
          for (const blocker of evaluation.blockers) {
            console.error(`  🔴 ${blocker}`);
          }
          process.exitCode = 1;
          return;
        }

        const frozen = freezeSpec(spec, {
          signed_off_by: options.signedOffBy,
          frozen_at: new Date().toISOString(),
        });
        const target = writeFrozenSpec(options.projectRoot, frozen);

        console.log(`▸ paqad · spec ${specId} frozen and signed off — sign-off recorded`);
        console.log(
          JSON.stringify({
            frozen: true,
            spec_id: specId,
            spec_hash: frozen.spec_hash,
            sidecar: target,
          }),
        );
      },
    );

  return command;
}
