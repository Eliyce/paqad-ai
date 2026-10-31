import { Command } from 'commander';

import { skillOrchestratorEnabled } from '@/authoring/config.js';
import { readFeaturePlan } from '@/feature-evidence/artifacts.js';
import { readChangeStartPoint } from '@/feature-evidence/delivery.js';
import {
  laneMayRise,
  planFiles,
  raiseLaneForAuthoring,
  raiseLaneIfGrown,
} from '@/feature-evidence/lane-resize.js';
import { readFeatureRecord } from '@/feature-evidence/feature-record.js';
import { currentFeature, readFeatureStageUnit } from '@/feature-evidence/stage-ledger.js';
import type { FeatureAuthoringLaneRaise, FeatureLaneMove } from '@/feature-evidence/types.js';
import { loadChangeEvidence } from '@/pipeline/change-evidence.js';
import { STAGE_ORDER } from '@/pipeline/feature-development-policy.js';
import { keepingLedgerSessionCache, resolveSessionId } from '@/rag-ledger/session.js';
import { normalizeArtifactPath } from '@/stage-evidence/artifact-path.js';
import { bundleArtifactFile, checkBundleArtifacts } from '@/stage-evidence/bundle-artifact.js';
import { recordMarkedStage } from '@/stage-evidence/live-writer.js';
import { liveStageAgents } from '@/stage-evidence/completion-deferred.js';
import { markerNarrationLine } from '@/stage-evidence/narration.js';
import { STAGE_AGENT_STAGES } from '@/stage-isolation/stage-agents.js';
import { buildStageBrief, resolveBriefSession } from '@/stage-isolation/stage-brief.js';
import { stageSettingsReport, writeStageSettings } from '@/stage-isolation/stage-settings.js';

import { laneRaisedLine } from './plan.js';

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
  agentId?: string;
}

function runStageSettings(options: StageOptions): void {
  const root = options.projectRoot;
  const sessionHint =
    options.session ?? process.env.SE_SESSION ?? process.env.CLAUDE_SESSION_ID ?? null;
  const sessionId = sessionHint?.trim() ? sessionHint.trim() : resolveSessionId(root, null);
  try {
    const settings = writeStageSettings(root, sessionId);
    console.log(JSON.stringify(stageSettingsReport(settings), null, 2));
  } catch (error) {
    console.error(`could not write the stage settings: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}

interface StageStartRaises {
  authoring: FeatureAuthoringLaneRaise | null;
  grown: FeatureLaneMove | null;
}

const NO_RAISES: StageStartRaises = { authoring: null, grown: null };

function authoringRaiseMayApply(root: string, dirName: string): boolean {
  const record = readFeatureRecord(root, dirName);
  return (
    record?.lane === 'fast' &&
    record.lane_raised_for_authoring === undefined &&
    skillOrchestratorEnabled(root)
  );
}

async function raiseLaneOnStageStart(root: string, sessionId: string): Promise<StageStartRaises> {
  const dirName = currentFeature(root, sessionId);
  if (dirName === null) return NO_RAISES;
  if (!authoringRaiseMayApply(root, dirName) && !laneMayRise(root, dirName)) return NO_RAISES;
  const { files } = await loadChangeEvidence(root, { since: readChangeStartPoint(root, dirName) });
  const input = {
    projectRoot: root,
    dirName,
    plannedFiles: planFiles(readFeaturePlan(root, dirName)?.steps),
    changedFiles: files,
  };
  const authoring = raiseLaneForAuthoring(input);
  const grown = laneMayRise(root, dirName) ? raiseLaneIfGrown(input) : null;
  return { authoring, grown };
}

function openStageAgentId(root: string, sessionId: string, dirName: string): string | null {
  const open = liveStageAgents(readFeatureStageUnit(root, dirName)).filter(
    (agent) => agent.agentId !== null && agent.sessionId === sessionId,
  );
  return open.at(-1)?.agentId ?? null;
}

function runStageBrief(stage: string | undefined, options: StageOptions): void {
  if (!stage || !STAGE_AGENT_STAGES.includes(stage)) {
    console.error(
      `name the stage to brief: one of ${STAGE_AGENT_STAGES.join(', ')}${stage ? ` (got "${stage}")` : ''}`,
    );
    process.exitCode = 1;
    return;
  }
  const root = options.projectRoot;
  let brief: string;
  try {
    brief = keepingLedgerSessionCache(root, () => {
      const sessionId = resolveBriefSession(root, { session_id: options.session }, process.env);
      const dirName = currentFeature(root, sessionId);
      if (dirName === null) {
        throw new Error(`no active change for session ${sessionId}`);
      }
      const agentId =
        options.agentId ?? process.env.SE_AGENT_ID ?? openStageAgentId(root, sessionId, dirName);
      return buildStageBrief(stage, root, sessionId, { agentId, resumed: true });
    });
  } catch (error) {
    console.error(`could not build the ${stage} stage brief: ${(error as Error).message}`);
    process.exitCode = 1;
    return;
  }
  console.log(brief);
}

export function createStageCommand(): Command {
  return new Command('stage')
    .description(
      'Mark a feature-development stage boundary in the stage-evidence ledger ' +
        '(clears the pre-code block for planning/specification)',
    )
    .argument(
      '<phase>',
      "'start' or 'end', 'settings' to print and record this project's per-stage effort and " +
        "model, or 'brief' to print a stage's brief for a resumed stage agent",
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
    .option(
      '--agent-id <id>',
      'On a `brief`, the host agent id to print on the command lines (defaults to SE_AGENT_ID, ' +
        "then the session's open stage-agent row)",
    )
    .action(async (phase: string, stage: string | undefined, options: StageOptions) => {
      if (phase === 'settings') {
        runStageSettings(options);
        return;
      }
      if (phase === 'brief') {
        runStageBrief(stage, options);
        return;
      }
      if (phase !== 'start' && phase !== 'end') {
        console.error(`unknown phase "${phase}" — use 'start', 'end', 'settings' or 'brief'`);
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
      const raised =
        phase === 'start' && !options.title && (STAGE_ORDER as string[]).includes(stage)
          ? await raiseLaneOnStageStart(root, sessionId)
          : NO_RAISES;
      const recorded = recordMarkedStage(root, {
        sessionId,
        sessionSource,
        stage,
        phase,
        artifactPaths,
        title: phase === 'start' ? options.title : undefined,
        issue: options.issue,
        agent: options.agent ?? process.env.PAQAD_STAGE_AGENT ?? undefined,
        agentId: phase === 'start' ? process.env.SE_AGENT_ID : undefined,
      });
      if (!recorded) {
        console.error(
          `could not record "${stage} ${phase}" — unknown stage "${stage}". ` +
            `Stages, in order: ${STAGE_ORDER.join(', ')}`,
        );
        process.exitCode = 1;
        return;
      }
      if (raised.authoring) console.log(laneRaisedLine(raised.authoring));
      if (raised.grown) console.log(laneRaisedLine(raised.grown));
      const line = markerNarrationLine(stage, phase);
      if (line) console.log(line);
      console.log(
        JSON.stringify({
          recorded: true,
          stage,
          phase,
          ...(raised.authoring ? { lane_raised_for_authoring: raised.authoring } : {}),
          ...(raised.grown ? { lane_raised: raised.grown } : {}),
        }),
      );
    });
}
