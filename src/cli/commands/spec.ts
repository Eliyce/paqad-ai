import { readFileSync, rmSync } from 'node:fs';
import { basename } from 'node:path';

import { Command } from 'commander';

import { reviewSpecification } from '@/compliance/spec-review.js';
import { sha256Hex } from '@/compliance/markdown.js';
import { buildFeatureSpec } from '@/spec/feature-spec-builder.js';
import { evaluateSpecFreeze, freezeSpec } from '@/spec/spec-freeze.js';
import {
  NoActiveFeatureError,
  readFeaturePlan,
  writeFeatureSpecification,
} from '@/feature-evidence/artifacts.js';
import { loadChangeEvidence } from '@/pipeline/change-evidence.js';
import { visualAcRequiredFiles } from '@/visual-evidence/readiness.js';
import { classifyBundlePath } from '@/feature-evidence/bundle-integrity.js';
import { currentFeature } from '@/feature-evidence/stage-ledger.js';
import { normalizeArtifactPath } from '@/stage-evidence/artifact-path.js';
import { resolveSessionId } from '@/rag-ledger/session.js';
import type { FeatureSpec } from '@/core/types/feature-spec.js';
import type { FreezeSpecInput } from '@/spec/spec-freeze.js';
import { readPipelineConfig } from '@/spec-pipeline/config.js';
import { clearFrozenRun, readFreezeSections, readStagedText } from '@/spec-pipeline/run-store.js';

import { createSpecPipelineCommand } from './spec-pipeline.js';

/**
 * `paqad-ai spec freeze <spec-file>` — the shell escape hatch that activates the
 * built-but-dead spec sign-off engine (issue #317). The specification stage promises
 * a frozen, signed-off spec before a line of code, but nothing ever ran the machinery
 * in `src/spec/`: no CLI verb, no instruction naming it. This verb is that caller. It
 * is invocation only — it reimplements none of the freeze logic:
 *
 *   buildFeatureSpec → reviewSpecification → evaluateSpecFreeze → freezeSpec
 *                    → writeFeatureSpecification
 *
 * Blockers (missing behaviour / acceptance criteria / invariants, an acceptance
 * criterion with no proof target, an unconfirmed invariant, an open question, and an
 * open CRITICAL spec-review defect) are printed and the command exits non-zero with
 * nothing frozen — a spec is never frozen silently over unresolved questions.
 *
 * The `reviewSpecification` step is issue #401: the contract had always claimed freeze
 * enforced "no critical spec-review defects" while this command passed no review at all,
 * so agents ran `compliance review` by hand and leaked a stray
 * `.paqad/compliance/<slug>/spec-review.json`. The review now runs inside freeze and its
 * summary rides in the frozen record, so the feature-development flow needs no second
 * command and writes no separate report. On a clean spec it writes the frozen spec into the
 * active feature's bundle at `<feature>/specification.json` (issue #343), the durable
 * record every frozen-spec reader now projects from.
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
    .option(
      '--session <id>',
      'Session id whose active feature receives specification.json (issue #339)',
    )
    .option('--keep-input', 'Keep the transient spec markdown instead of deleting it', false)
    .option(
      '--from-pipeline',
      'Freeze a spec the spec pipeline crafted, merging its run into the record',
      false,
    )
    .option('--manual', 'Freeze a hand-written spec under strict adoption (needs --reason)', false)
    .option('--reason <why>', 'Why the spec was frozen without the pipeline (recorded)')
    .action(
      async (
        specFile: string,
        options: {
          projectRoot: string;
          signedOffBy: string;
          specId?: string;
          confirmInvariants: boolean;
          session?: string;
          keepInput?: boolean;
          fromPipeline?: boolean;
          manual?: boolean;
          reason?: string;
        },
      ) => {
        // Issue #401: a spec that resolves outside the project root is rejected outright.
        // Freeze used to swallow the normalize failure and then record the raw input as
        // `spec_file`, so a spec authored in `/tmp` was frozen with a non-portable absolute
        // path (and the compliance report beside it recorded a `../../../..` escape). The
        // tree-boundary judgement routes through the canonical `normalizeArtifactPath`
        // helper — the same one the stage recorder uses — never a local re-derivation.
        let relSpec: string;
        try {
          relSpec = normalizeArtifactPath(options.projectRoot, specFile);
        } catch {
          console.error(
            `**▸ paqad** · a spec has to live inside the project so its record stays ` +
              `portable, and ${specFile} resolves outside it. Author it in the repo and ` +
              `freeze it from there.`,
          );
          process.exitCode = 1;
          return;
        }

        // Issue #402: never read (and so never bless) a spec authored INSIDE a feature
        // bundle dir. That dir holds only rigid, script-owned artifacts; a spec markdown
        // in there is the duplicate-of-specification.json pollution this fixes.
        if (classifyBundlePath(relSpec) !== null) {
          console.error(
            `**▸ paqad** · a feature bundle holds only its rigid artifacts, so a spec can't ` +
              `live at ${relSpec}. Author it outside \`.paqad/ledger/feature-evidence/\` — ` +
              `the freeze writes specification.json into the bundle for you.`,
          );
          process.exitCode = 1;
          return;
        }

        let markdown: string;
        try {
          markdown = readFileSync(specFile, 'utf8');
        } catch {
          console.error(`could not read spec file "${specFile}"`);
          process.exitCode = 1;
          return;
        }

        const specId = options.specId ?? basename(specFile).replace(/\.[^.]+$/, '');
        // `relSpec`, not the raw input: the frozen record pins a project-relative posix
        // path, so it reads the same on every machine and on Windows (issue #401).
        const built = buildFeatureSpec({
          spec_id: specId,
          spec_file: relSpec,
          spec_markdown: markdown,
        });

        // Confirming invariants IS the human sign-off act: the operator running this
        // verb with --confirm-invariants is affirming every invariant. Without the
        // flag, unconfirmed invariants stay blockers (honest — freeze is never implied).
        const spec: FeatureSpec = options.confirmInvariants
          ? { ...built, invariants: built.invariants.map((inv) => ({ ...inv, confirmed: true })) }
          : built;

        // Issue #547 — spec-pipeline adoption. When the pipeline is on, freeze either merges the
        // staged run (`--from-pipeline`, issue #581: task, grounding, pipeline and trace sections)
        // or records in the `pipeline` section why it did not; under strict adoption a
        // hand-written spec is refused unless `--manual --reason` is given. With the pipeline off,
        // freeze writes none of those sections and behaves exactly as before.
        const pipelineConfig = readPipelineConfig(options.projectRoot);
        let sections: FreezeSpecInput['sections'];
        let frozenWithoutPipeline = false;
        if (pipelineConfig.enabled) {
          if (options.fromPipeline) {
            const sessionId = resolveSessionId(
              options.projectRoot,
              options.session ?? process.env.SE_SESSION ?? process.env.CLAUDE_SESSION_ID ?? null,
            );
            const dirName = currentFeature(options.projectRoot, sessionId);
            if (!dirName) {
              console.error('no active feature — run `paqad-ai stage start planning` first');
              process.exitCode = 1;
              return;
            }
            const runSections = readFreezeSections(options.projectRoot, dirName);
            if (!runSections) {
              console.error('run `paqad-ai spec pipeline finish` first');
              process.exitCode = 1;
              return;
            }
            const runSpec = readStagedText(options.projectRoot, dirName, 'craft');
            if (runSpec === null || sha256Hex(runSpec) !== built.spec_hash) {
              console.error('the spec you are freezing is not the one the pipeline crafted');
              process.exitCode = 1;
              return;
            }
            sections = runSections;
          } else if (options.manual) {
            if (!options.reason) {
              console.error('--manual needs --reason "<why>" (recorded on the frozen spec)');
              process.exitCode = 1;
              return;
            }
            sections = { pipeline: { produced: false, manual_reason: options.reason } };
          } else if (pipelineConfig.adoption === 'strict') {
            console.error(
              'this project requires the spec pipeline (spec_pipeline_adoption=strict); run it, or freeze with --manual --reason "<why>"',
            );
            process.exitCode = 1;
            return;
          } else {
            sections = { pipeline: { produced: false } };
            frozenWithoutPipeline = true;
          }
        }

        // Issue #401 — the freeze contract has always promised "no critical spec-review
        // defects", but this command evaluated the freeze with no review attached, so the
        // clause was enforced nowhere and agents hand-ran `compliance review` to satisfy it
        // (leaking a stray `.paqad/compliance/<slug>/spec-review.json`). Running the review
        // HERE makes the promise real: the report feeds the existing critical-defect check
        // in `evaluateSpecFreeze`, which this command invokes rather than reimplements. The
        // report is never persisted separately; its summary rides along in the frozen record.
        const specReview = reviewSpecification({
          spec_file: relSpec,
          spec_markdown: markdown,
        });

        // Issue #579 (FR-14) — a frontend change under visual evidence needs a (proof: visual)
        // criterion. Frontend-ness comes from the active plan's step files and the changed files.
        const freezeSession = resolveSessionId(
          options.projectRoot,
          options.session ?? process.env.SE_SESSION ?? process.env.CLAUDE_SESSION_ID ?? null,
        );
        const freezeFeature = currentFeature(options.projectRoot, freezeSession);
        const planFiles = freezeFeature
          ? (readFeaturePlan(options.projectRoot, freezeFeature)?.steps ?? []).flatMap(
              (step) => step.files ?? [],
            )
          : [];
        const visualFiles = visualAcRequiredFiles(options.projectRoot, [
          ...planFiles,
          ...(await loadChangeEvidence(options.projectRoot)).files,
        ]);
        const evaluation = evaluateSpecFreeze(
          spec,
          specReview,
          visualFiles.length > 0 ? { requireVisualAc: { files: visualFiles } } : {},
        );
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
          spec_review: specReview,
          ...(sections ? { sections } : {}),
        });

        if (frozenWithoutPipeline) {
          console.log('▸ paqad · frozen without the pipeline; the record says so');
        }

        // Issue #343 (Phase-7 cutover) — the frozen spec's ONLY home is the active feature's
        // bundle `specification.json` (the legacy `.paqad/specs/<id>.frozen.json` sidecar is
        // retired). Every frozen-spec reader now projects from the bundles. With no active
        // feature (a standalone freeze) nothing is persisted — the freeze still succeeds, but
        // it names no bundle, so the caller knows to run `paqad-ai stage start planning` first.
        let bundlePath: string | null = null;
        let bundleDir: string | null = null;
        try {
          const sessionId = resolveSessionId(
            options.projectRoot,
            options.session ?? process.env.SE_SESSION ?? process.env.CLAUDE_SESSION_ID ?? null,
          );
          const written = writeFeatureSpecification(
            options.projectRoot,
            sessionId,
            frozen,
            markdown,
          );
          bundlePath = written.path;
          bundleDir = written.dirName;
        } catch (error) {
          if (!(error instanceof NoActiveFeatureError)) {
            throw error;
          }
        }

        // Transient scratch (issue #402): the markdown has been built, hashed, frozen into
        // specification.json and copied into the bundle as spec.md (issue #581), so the source
        // is deleted for the same reason `plan compile` deletes its template: it is never a
        // second, editable source of truth. Best-effort.
        //
        // Gated on `bundlePath` and not merely on the freeze succeeding: a standalone
        // freeze with no active feature swallows NoActiveFeatureError above and persists
        // NOTHING, so deleting there would destroy the only copy of the spec. Delete only
        // once the frozen record demonstrably lives in a bundle.
        if (!options.keepInput && bundlePath !== null) {
          try {
            rmSync(specFile, { force: true });
          } catch {
            /* best-effort: a leftover spec is harmless, never fail the freeze for it */
          }
        }

        // Issue #581 (FR-4, AC-3) — the run now lives in specification.json, so its staging dir
        // and every `.paqad/tmp/` input a record verb was handed go. `--keep-input` still keeps
        // the spec source itself.
        if (bundleDir !== null) {
          clearFrozenRun(options.projectRoot, bundleDir, options.keepInput ? [relSpec] : []);
        }

        console.log(`▸ paqad · spec ${specId} frozen and signed off — sign-off recorded`);
        console.log(
          JSON.stringify({
            frozen: true,
            spec_id: specId,
            spec_hash: frozen.spec_hash,
            specification: bundlePath,
          }),
        );
      },
    );

  command.addCommand(createSpecPipelineCommand());

  return command;
}
