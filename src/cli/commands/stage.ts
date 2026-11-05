import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { Command } from 'commander';

import { sha256Hex } from '@/compliance/markdown.js';
import { readFeaturePlan } from '@/feature-evidence/artifacts.js';
import {
  repairActor,
  repairChainBreak,
  stageAgentRepairRefusal,
} from '@/feature-evidence/chain-repair.js';
import { readChangeStartPoint } from '@/feature-evidence/delivery.js';
import {
  laneMayRise,
  planFiles,
  authoringRaiseEnabled,
  raiseLaneForAuthoring,
  raiseLaneIfGrown,
} from '@/feature-evidence/lane-resize.js';
import { readChangeConstants, readFeatureRecord } from '@/feature-evidence/feature-record.js';
import { featureFilePath } from '@/feature-evidence/paths.js';
import { currentFeature, readFeatureStageUnit } from '@/feature-evidence/stage-ledger.js';
import type { FeatureAuthoringLaneRaise, FeatureLaneMove } from '@/feature-evidence/types.js';
import { loadChangeEvidence } from '@/pipeline/change-evidence.js';
import { addedLinesSince } from '@/pipeline/git-paths.js';
import { STAGE_ORDER } from '@/pipeline/feature-development-policy.js';
import { keepingLedgerSessionCache, resolveSessionId } from '@/rag-ledger/session.js';
import { normalizeArtifactPath } from '@/stage-evidence/artifact-path.js';
import { bundleArtifactFile, checkBundleArtifacts } from '@/stage-evidence/bundle-artifact.js';
import { recordMarkedStage } from '@/stage-evidence/live-writer.js';
import { liveStageAgents } from '@/stage-evidence/completion-deferred.js';
import { markerNarrationLine } from '@/stage-evidence/narration.js';
import { STAGE_AGENT_STAGES } from '@/stage-isolation/stage-agents.js';
import {
  runStageBegin,
  stageContentMarkdown,
  STAGE_CONTENT_MAX_CHARS,
} from '@/stage-isolation/stage-begin.js';
import { checkRecipe, type RecipeCheck } from '@/stage-isolation/recipe-check.js';
import { RECIPE_HEADING, resolveRecipe } from '@/stage-isolation/recipes.js';
import {
  buildStageBrief,
  recordRecipeInjected,
  resolveBriefSession,
} from '@/stage-isolation/stage-brief.js';
import {
  buildStageReport,
  stageReportOptions,
  stageStartRefusal,
  unknownAgentReport,
} from '@/stage-isolation/stage-handback.js';
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
  full?: boolean;
  staleOk?: string[];
  reason?: string;
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
    authoringRaiseEnabled(root)
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

function briefRecipeSection(
  root: string,
  sessionId: string,
  stage: string,
  agentId: string | null,
): string {
  let recipe;
  try {
    recipe = resolveRecipe(stage);
  } catch (error) {
    return `**▸ paqad** · ${(error as Error).message}`;
  }
  const text = `${RECIPE_HEADING}\n\n${recipe.body}`;
  if (typeof process.env.SE_AGENT_ID === 'string' && agentId !== null) {
    const dirName = currentFeature(root, sessionId);
    const codex = dirName !== null && readFeatureRecord(root, dirName)?.adapter === 'codex-cli';
    if (!codex) {
      recordRecipeInjected(
        root,
        stage,
        { session_id: sessionId, agent_id: agentId },
        {
          recipe: recipe.name,
          recipe_hash: sha256Hex(text),
          recipe_root: recipe.root,
          truncated: false,
        },
      );
    }
  }
  return text;
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
      const text = buildStageBrief(stage, root, sessionId, {
        agentId,
        resumed: true,
        full: options.full === true,
      });
      const recipe = briefRecipeSection(root, sessionId, stage, agentId);
      const head = `${text}\n\n${recipe}`;
      const room = STAGE_CONTENT_MAX_CHARS - head.length - 2;
      return `${head}\n\n${stageContentMarkdown(root, dirName, stage, room)}`;
    });
  } catch (error) {
    console.error(`could not build the ${stage} stage brief: ${(error as Error).message}`);
    process.exitCode = 1;
    return;
  }
  console.log(brief);
}

function startRefusalMessage(root: string, sessionId: string, stage: string): string | null {
  try {
    const dirName = currentFeature(root, sessionId);
    if (dirName === null) return null;
    const rows = readFeatureStageUnit(root, dirName);
    const lane = readChangeConstants(root, dirName, rows).lane;
    return stageStartRefusal(rows, stage, lane, stageReportOptions(root, dirName))?.message ?? null;
  } catch {
    return null;
  }
}

async function stageEndRecipeCheck(
  root: string,
  sessionId: string,
  stage: string,
  options: StageOptions,
): Promise<RecipeCheck | null> {
  try {
    const dirName = currentFeature(root, sessionId);
    if (dirName === null) return null;
    if (stage === 'development') {
      const spec = join(root, featureFilePath(dirName, 'specification'));
      if (!existsSync(spec)) return null;
      const start = readChangeStartPoint(root, dirName);
      const added = start === null ? null : addedLinesSince(root, start);
      return checkRecipe({
        projectRoot: root,
        sessionId,
        stage,
        args: added === null ? [spec, root] : [spec, root, '--added-stdin'],
        ...(added === null ? {} : { input: JSON.stringify(added) }),
      });
    }
    if (stage === 'documentation_sync') {
      const staleOk = options.staleOk ?? [];
      const { files } = await loadChangeEvidence(root, {
        since: readChangeStartPoint(root, dirName),
      });
      return checkRecipe({
        projectRoot: root,
        sessionId,
        stage,
        args: [root, ...staleOk.flatMap((path) => ['--ok', path])],
        input: files.join('\n'),
        staleOk,
      });
    }
    return null;
  } catch {
    return null;
  }
}

function runStageBeginPhase(stage: string | undefined, options: StageOptions): void {
  const root = options.projectRoot;
  const name = stage ?? '';
  const agent = options.agent ?? process.env.PAQAD_STAGE_AGENT ?? undefined;
  const hint = options.session ?? process.env.SE_SESSION ?? process.env.CLAUDE_SESSION_ID ?? null;
  const sessionId = resolveSessionId(root, hint);
  const { exitCode, output } = STAGE_AGENT_STAGES.includes(name)
    ? runStageBegin({
        projectRoot: root,
        sessionId,
        stage: name,
        agent,
        agentId: process.env.SE_AGENT_ID ?? null,
      })
    : {
        exitCode: 1 as const,
        output: {
          stage: name,
          failed_step: 'stage start',
          error: `name the stage to begin: one of ${STAGE_AGENT_STAGES.join(', ')}`,
        },
      };
  process.exitCode = exitCode;
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

function runStageRepair(rowArg: string | undefined, options: StageOptions): void {
  const root = options.projectRoot;
  const refusal = stageAgentRepairRefusal(process.env.SE_AGENT_ID);
  if (refusal !== null) {
    console.error(`**▸ paqad** · ${refusal}`);
    process.exitCode = 1;
    return;
  }
  const rowNumber = Number(rowArg);
  const reason = options.reason?.trim();
  if (!Number.isInteger(rowNumber) || rowNumber < 1 || !reason) {
    console.error('usage: paqad-ai stage repair <row> --reason "<what happened>"');
    process.exitCode = 2;
    return;
  }
  const hint = options.session ?? process.env.SE_SESSION ?? process.env.CLAUDE_SESSION_ID ?? null;
  const sessionId = resolveSessionId(root, hint);
  const dirName = currentFeature(root, sessionId);
  if (dirName === null) {
    console.error('**▸ paqad** · no change is active, so there is no ledger to repair');
    process.exitCode = 1;
    return;
  }
  const result = repairChainBreak(root, sessionId, dirName, rowNumber, reason, repairActor());
  console[result.ok ? 'log' : 'error'](`**▸ paqad** · ${result.message}`);
  if (!result.ok) process.exitCode = 1;
}

function runStageReport(agentId: string | undefined, options: StageOptions): void {
  if (!agentId) {
    console.log(JSON.stringify(unknownAgentReport('', 'name the agent id to report on')));
    process.exitCode = 1;
    return;
  }
  const root = options.projectRoot;
  try {
    const report = keepingLedgerSessionCache(root, () => {
      const sessionId = resolveBriefSession(root, { session_id: options.session }, process.env);
      const dirName = currentFeature(root, sessionId);
      if (dirName === null) return null;
      return buildStageReport(
        readFeatureStageUnit(root, dirName),
        agentId,
        stageReportOptions(root, dirName),
      );
    });
    if (report === null) process.exitCode = 1;
    console.log(
      JSON.stringify(report ?? unknownAgentReport(agentId, `no stage row names agent ${agentId}`)),
    );
  } catch (error) {
    console.log(
      JSON.stringify(
        unknownAgentReport(agentId, `could not read the ledger: ${(error as Error).message}`),
      ),
    );
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
      "'start' or 'end', 'begin' to start a stage and print what it needs as one JSON object, 'settings' to print and record this project's per-stage effort and " +
        "model, 'brief' to print a stage's brief for a resumed stage agent, 'report' to " +
        "print what a stage agent reported, as JSON, from its agent id, or 'repair' to record " +
        'why a ledger row broke the chain',
    )
    .argument(
      '[stage]',
      `one of: ${STAGE_ORDER.join(', ')}; for 'report', the agent id; for 'repair', the row number`,
    )
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
      'On a `start`, name this change. An active change with no title yet is titled in ' +
        'place; otherwise this opens a NEW named feature (the "new work" signal), pausing ' +
        'the active one and minting a distinct evidence bundle',
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
    .option('--full', 'On a `brief`, print every read entry and instruction, with no length cut')
    .option(
      '--stale-ok <path>',
      'On `end documentation_sync`, a doc that needs no change although the diff touches its module (repeatable)',
      collectArtifact,
    )
    .option('--reason <text>', 'On a `repair`, what happened to the row')
    .action(async (phase: string, stage: string | undefined, options: StageOptions) => {
      if (phase === 'settings') {
        runStageSettings(options);
        return;
      }
      if (phase === 'brief') {
        runStageBrief(stage, options);
        return;
      }
      if (phase === 'begin') {
        runStageBeginPhase(stage, options);
        return;
      }
      if (phase === 'report') {
        runStageReport(stage, options);
        return;
      }
      if (phase === 'repair') {
        runStageRepair(stage, options);
        return;
      }
      if (phase !== 'start' && phase !== 'end') {
        console.error(
          `unknown phase "${phase}" — use 'start', 'end', 'begin', 'settings', 'brief', 'report' or 'repair'`,
        );
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
      if (phase === 'start' && !options.title) {
        const refusal = startRefusalMessage(root, sessionId, stage);
        if (refusal !== null) {
          console.error(`**▸ paqad** · ${refusal}`);
          process.exitCode = 1;
          return;
        }
      }
      const raised =
        phase === 'start' && !options.title && (STAGE_ORDER as string[]).includes(stage)
          ? await raiseLaneOnStageStart(root, sessionId)
          : NO_RAISES;
      const recipeCheck =
        phase === 'end' ? await stageEndRecipeCheck(root, sessionId, stage, options) : null;
      for (const line of recipeCheck?.lines ?? []) console.error(line);
      if (recipeCheck?.verdict === 'refuse') {
        process.exitCode = 1;
        return;
      }
      const recorded = recordMarkedStage(root, {
        sessionId,
        sessionSource,
        stage,
        phase,
        artifactPaths,
        title: phase === 'start' ? options.title : undefined,
        issue: options.issue,
        agent: options.agent ?? (process.env.PAQAD_STAGE_AGENT?.trim() || undefined),
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
      recipeCheck?.record();
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
