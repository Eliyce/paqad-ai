import { Command } from 'commander';

import { STAGE_ORDER } from '@/pipeline/feature-development-policy.js';
import { resolveSessionId } from '@/rag-ledger/session.js';
import { normalizeArtifactPath } from '@/stage-evidence/artifact-path.js';
import { bundleArtifactFile, checkBundleArtifacts } from '@/stage-evidence/bundle-artifact.js';
import { recordMarkedStage } from '@/stage-evidence/live-writer.js';
import { markerNarrationLine } from '@/stage-evidence/narration.js';
import { stageSettingsReport, writeStageSettings } from '@/stage-isolation/stage-settings.js';

function collectArtifact(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

interface StageOptions {
  projectRoot: string;
  session?: string;
  artifact?: string[];
  title?: string;
  issue?: string;
  agent?: string;
}

function runStageSettings(options: StageOptions): void {
  const root = options.projectRoot;
  const sessionHint =
    options.session ?? process.env.SE_SESSION ?? process.env.CLAUDE_SESSION_ID ?? null;
  const sessionId = sessionHint?.trim() ? sessionHint.trim() : resolveSessionId(root, null);
  try {
    const settings = writeStageSettings(root, sessionId);
    console.log(stageSettingsReport(settings).join('\n'));
  } catch (error) {
    console.error(`could not write the stage settings: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}

export function createStageCommand(): Command {
  return new Command('stage')
    .description(
      'Mark a feature-development stage boundary in the stage-evidence ledger ' +
        '(clears the pre-code block for planning/specification)',
    )
    .argument(
      '<phase>',
      "'start' or 'end', or 'settings' to print and record this project's per-stage effort and model",
    )
    .argument('[stage]', `one of: ${STAGE_ORDER.join(', ')}`)
    .option('--project-root <path>', 'Project root', process.cwd())
    .option(
      '--session <id>',
      'Session id to record under (defaults to SE_SESSION / CLAUDE_SESSION_ID, then the shared ledger-session cache)',
    )
    .option(
      '--artifact <path>',
      'Artifact the stage produced (repeatable); its real on-disk bytes are hashed so a ' +
        'thinking stage (planning/specification/review) proves work, not just a claim',
      collectArtifact,
    )
    .option(
      '--title <title>',
      'On a `start`, open a NEW named feature for this change (the "new work" signal); ' +
        'pauses any active feature and mints a distinct evidence bundle',
    )
    .option('--issue <ref>', 'Ticket/issue ref for a titled feature (e.g. <number>, PQD-123)')
    .option(
      '--agent <name>',
      'The agent recording this boundary, e.g. paqad-planning. A dispatched ' +
        'stage agent passes its own name so the row is attributable; omitted means the ' +
        'orchestrator marked it inline. Defaults to PAQAD_STAGE_AGENT when set.',
    )
    .action((phase: string, stage: string | undefined, options: StageOptions) => {
      if (phase === 'settings') {
        runStageSettings(options);
        return;
      }
      if (phase !== 'start' && phase !== 'end') {
        console.error(`unknown phase "${phase}" — use 'start', 'end' or 'settings'`);
        process.exitCode = 1;
        return;
      }
      if (!stage) {
        console.error(`name the stage to ${phase}: one of ${STAGE_ORDER.join(', ')}`);
        process.exitCode = 1;
        return;
      }
      const root = options.projectRoot;
      const sessionHint =
        options.session ?? process.env.SE_SESSION ?? process.env.CLAUDE_SESSION_ID ?? null;
      const sessionId = resolveSessionId(root, sessionHint);
      const sessionSource = sessionHint?.trim() ? 'env' : 'cache';
      let artifactPaths: string[] | undefined;
      if (phase === 'end' && options.artifact) {
        let normalized: string[];
        try {
          normalized = options.artifact.map((raw) => normalizeArtifactPath(root, raw));
        } catch (error) {
          console.error(`could not record "${stage} ${phase}" — ${(error as Error).message}`);
          process.exitCode = 1;
          return;
        }
        const check = checkBundleArtifacts(root, sessionId, stage, normalized);
        if (check.rigid && check.accepted.length === 0 && check.rejected.length > 0) {
          const target = check.expected ?? `the bundle's ${bundleArtifactFile(stage)}.json`;
          console.error(
            `**▸ paqad** · that file isn't ${stage}'s bundle artifact — run ` +
              `\`npx ${check.verb} …\` first, then end ${stage} against ${target}. ` +
              `Recording ${stage} as inconclusive.`,
          );
        } else if (!check.rigid && check.rejected.length > 0) {
          console.error(
            `**▸ paqad** · a feature bundle holds only its rigid artifacts, so ` +
              `${check.rejected.join(', ')} can't prove ${stage} — keep the artifact ` +
              `outside \`.paqad/ledger/feature-evidence/\` and end ${stage} against that path.`,
          );
        }
        artifactPaths = check.accepted.length > 0 ? check.accepted : undefined;
      }
      const recorded = recordMarkedStage(root, {
        sessionId,
        sessionSource,
        stage,
        phase,
        artifactPaths,
        title: phase === 'start' ? options.title : undefined,
        issue: options.issue,
        agent: options.agent ?? process.env.PAQAD_STAGE_AGENT ?? undefined,
      });
      if (!recorded) {
        console.error(
          `could not record "${stage} ${phase}" — unknown stage "${stage}". ` +
            `Stages, in order: ${STAGE_ORDER.join(', ')}`,
        );
        process.exitCode = 1;
        return;
      }
      const line = markerNarrationLine(stage, phase);
      if (line) console.log(line);
      console.log(JSON.stringify({ recorded: true, stage, phase }));
    });
}
