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
import { readChangeConstants } from '@/feature-evidence/feature-record.js';
import { laneRunsSpecPipeline } from '@/feature-evidence/manifest.js';
import { normalizeArtifactPath } from '@/stage-evidence/artifact-path.js';
import { resolveSessionId } from '@/rag-ledger/session.js';
import type { FeatureSpec } from '@/core/types/feature-spec.js';
import type { FreezeSpecInput } from '@/spec/spec-freeze.js';
import { readPipelineConfig } from '@/spec-pipeline/config.js';
import { clearFrozenRun, readFreezeSections, readStagedText } from '@/spec-pipeline/run-store.js';

import { createSpecPipelineCommand } from './spec-pipeline.js';

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
    .option('--session <id>', 'Session id whose active feature receives specification.json')
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
        const built = buildFeatureSpec({
          spec_id: specId,
          spec_file: relSpec,
          spec_markdown: markdown,
        });

        const spec: FeatureSpec = options.confirmInvariants
          ? { ...built, invariants: built.invariants.map((inv) => ({ ...inv, confirmed: true })) }
          : built;

        const freezeSession = resolveSessionId(
          options.projectRoot,
          options.session ?? process.env.SE_SESSION ?? process.env.CLAUDE_SESSION_ID ?? null,
        );
        const freezeFeature = currentFeature(options.projectRoot, freezeSession);
        const pipelineConfig = readPipelineConfig(options.projectRoot);
        const freezeLaneRunsPipeline = laneRunsSpecPipeline(
          freezeFeature ? readChangeConstants(options.projectRoot, freezeFeature).lane : null,
        );
        let sections: FreezeSpecInput['sections'];
        let frozenWithoutPipeline = false;
        if (pipelineConfig.enabled && !freezeLaneRunsPipeline) {
          sections = { pipeline: { produced: false, skipped: 'fast-lane' } };
        } else if (pipelineConfig.enabled) {
          if (options.fromPipeline) {
            const dirName = freezeFeature;
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

        const specReview = reviewSpecification({
          spec_file: relSpec,
          spec_markdown: markdown,
        });

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
          console.log('**▸ paqad** · frozen without the pipeline; the record says so');
        }

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

        if (!options.keepInput && bundlePath !== null) {
          try {
            rmSync(specFile, { force: true });
          } catch {}
        }

        if (bundleDir !== null) {
          clearFrozenRun(options.projectRoot, bundleDir, options.keepInput ? [relSpec] : []);
        }

        console.log(`**▸ paqad** · spec ${specId} frozen and signed off — sign-off recorded`);
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
