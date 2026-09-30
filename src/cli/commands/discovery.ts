import { readFileSync } from 'node:fs';

import { Command } from 'commander';

import { activeDiscoveryRunForSession } from '@/discovery/boundary.js';
import { foldDiscoveryRun } from '@/discovery/fold.js';
import { recordDiscoveryStage } from '@/discovery/recorder.js';
import { writeDiscoveryReport } from '@/discovery/report.js';
import {
  openDiscoveryRun,
  readDiscoveryRun,
  resolveDiscoveryRunDir,
  updateDiscoveryRun,
} from '@/discovery/run-store.js';
import { readDiscoveryStageRows } from '@/discovery/recorder.js';
import { isKnownDiscoveryStage } from '@/discovery/stages.js';
import {
  DISCOVERY_OUTCOMES,
  DISCOVERY_RUN_STATUSES,
  isDiscoveryOutcome,
  isDiscoveryRunStatus,
} from '@/discovery/types.js';
import { recordContextReceipt } from '@/discovery/context-receipts.js';
import {
  appendBlocker,
  appendContribution,
  appendSource,
  writeBrief,
  writeDecisions,
  writeHandoff,
  writeReadiness,
  writeSynthesis,
  type DiscoveryWriteContext,
} from '@/discovery/writers.js';
import { resolveSessionId } from '@/rag-ledger/session.js';
import {
  readWorkflowState,
  writeWorkflowState,
  type WorkflowState,
} from '@/pipeline/workflow-state.js';

interface CommonOptions {
  projectRoot: string;
  session?: string;
}

function session(root: string, opts: CommonOptions): string {
  return resolveSessionId(
    root,
    opts.session ?? process.env.SE_SESSION ?? process.env.CLAUDE_SESSION_ID ?? null,
  );
}

function loadTemplate(file: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Resolve the run to act on: an explicit `--run <ref>`, else the session's active anchor. */
function resolveRun(root: string, sessionId: string, runOpt: string | undefined): string | null {
  if (runOpt !== undefined && runOpt.trim().length > 0) {
    return resolveDiscoveryRunDir(root, runOpt);
  }
  return activeDiscoveryRunForSession(root, sessionId);
}

function fail(message: string): void {
  console.error(`**▸ paqad** · ${message}`);
  process.exitCode = 1;
}

/**
 * Make `dirName` the session's active Discovery run, pausing whatever was active. Unlike
 * `routeWorkflow` (whose resume branch would return a paused discovery entry verbatim and ignore the
 * requested run), this always anchors the ACTIVE entry to the exact run — so `start B` after run A
 * was paused activates B (not A), and `resume <ref>` re-anchors to the resumed run. A paused entry
 * for the same run is dropped so it is never both active and paused.
 */
function activateDiscoveryRun(root: string, sessionId: string, dirName: string): void {
  const state = readWorkflowState(root, sessionId);
  const active = state.active;
  const alreadyActive = active?.workflow === 'discovery' && active.discoveryRunId === dirName;
  const paused = state.paused.filter(
    (entry) => !(entry.workflow === 'discovery' && entry.discoveryRunId === dirName),
  );
  const nextPaused = active && !alreadyActive ? [...paused, active] : paused;
  const next: WorkflowState = {
    active: { workflow: 'discovery', discoveryRunId: dirName },
    paused: nextPaused,
  };
  if (state.turn_started_at !== undefined) {
    next.turn_started_at = state.turn_started_at;
  }
  writeWorkflowState(root, sessionId, next);
}

function writeCtx(root: string, dirName: string, sessionId: string): DiscoveryWriteContext {
  return { projectRoot: root, dirName, sessionId };
}

function projectRootOption(command: Command): Command {
  return command
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--session <id>', 'Session id (defaults to SE_SESSION / CLAUDE_SESSION_ID)');
}

/**
 * `paqad-ai discovery …` — drive a standalone Discovery run (issue #597). Every canonical artifact
 * is script-written under `.paqad/ledger/delivery/<run>/`; the model supplies substantive content
 * through the record templates. This group is Discovery-only: it never touches feature evidence.
 */
export function createDiscoveryCommand(): Command {
  const discovery = new Command('discovery').description(
    'Drive a standalone Discovery run (understand → investigate → refine → decide → check readiness → hand off)',
  );

  projectRootOption(
    discovery
      .command('start')
      .description('Open a new Discovery run and make it the session’s active workflow')
      .requiredOption('--title <title>', 'A short title for the run')
      .option('--issue <ref>', 'Ticket/issue ref (e.g. 597, PQD-12)')
      .option('--adapter <name>', 'Host adapter', 'claude-code'),
  ).action((opts: CommonOptions & { title: string; issue?: string; adapter: string }) => {
    const root = opts.projectRoot;
    const sessionId = session(root, opts);
    const { dirName, record } = openDiscoveryRun(root, {
      sessionId,
      title: opts.title,
      issue: opts.issue ?? undefined,
      adapter: opts.adapter,
    });
    activateDiscoveryRun(root, sessionId, dirName);
    console.log(`**▸ paqad** · opened Discovery run ${dirName} (status ${record.status})`);
    console.log(JSON.stringify({ started: true, run: dirName }));
  });

  projectRootOption(
    discovery
      .command('stage')
      .description('Record a Discovery stage boundary in the run’s evidence ledger')
      .argument('<phase>', "'start' or 'end'")
      .argument(
        '<stage>',
        'understand | investigate | refine | decide | check_readiness | hand_off',
      )
      .option('--run <ref>', 'The run (dir name, ULID, or slug); defaults to the active run')
      .option(
        '--artifact <path>',
        'Artifact the stage produced (an end only); its bytes are hashed',
      ),
  ).action(
    (phase: string, stage: string, opts: CommonOptions & { run?: string; artifact?: string }) => {
      const root = opts.projectRoot;
      const sessionId = session(root, opts);
      if (phase !== 'start' && phase !== 'end') {
        return fail(`unknown phase "${phase}" — use 'start' or 'end'`);
      }
      if (!isKnownDiscoveryStage(stage)) {
        return fail(`"${stage}" is not one of the six Discovery stages`);
      }
      const dirName = resolveRun(root, sessionId, opts.run);
      if (dirName === null) {
        return fail('no Discovery run — pass --run or start one first');
      }
      const revision = readDiscoveryRun(root, dirName)?.revision ?? 1;
      recordDiscoveryStage(root, dirName, {
        sessionId,
        stage,
        phase,
        revision,
        artifactPath: phase === 'end' ? opts.artifact : undefined,
      });
      console.log(JSON.stringify({ recorded: true, stage, phase, run: dirName }));
    },
  );

  addRecordSubcommand(discovery);

  projectRootOption(
    discovery
      .command('status')
      .description('Show the active run’s stages and completion verdict')
      .option('--run <ref>', 'The run; defaults to the active run'),
  ).action((opts: CommonOptions & { run?: string }) => {
    const root = opts.projectRoot;
    const sessionId = session(root, opts);
    const dirName = resolveRun(root, sessionId, opts.run);
    if (dirName === null) {
      return fail('no Discovery run to report');
    }
    const run = readDiscoveryRun(root, dirName);
    const folded = foldDiscoveryRun(readDiscoveryStageRows(root, dirName));
    console.log(
      `**▸ paqad** · Discovery run ${dirName} — status ${run?.status ?? '?'}, verdict ${folded.verdict}`,
    );
    console.log(
      JSON.stringify({
        run: dirName,
        status: run?.status ?? null,
        outcome: run?.outcome ?? null,
        verdict: folded.verdict,
        missing: folded.missing,
      }),
    );
  });

  projectRootOption(
    discovery
      .command('resume')
      .description('Resume a run and make it the session’s active workflow')
      .argument('<ref>', 'The run (dir name, ULID, or slug)'),
  ).action((ref: string, opts: CommonOptions) => {
    const root = opts.projectRoot;
    const sessionId = session(root, opts);
    const dirName = resolveDiscoveryRunDir(root, ref);
    if (dirName === null) {
      return fail(`no Discovery run matches "${ref}"`);
    }
    activateDiscoveryRun(root, sessionId, dirName);
    console.log(`**▸ paqad** · resumed Discovery run ${dirName}`);
    console.log(JSON.stringify({ resumed: true, run: dirName }));
  });

  projectRootOption(
    discovery
      .command('set-status')
      .description('Update the run’s execution status (and optionally its hand-off outcome)')
      .argument('<status>', DISCOVERY_RUN_STATUSES.join(' | '))
      .option('--run <ref>', 'The run; defaults to the active run')
      .option('--outcome <outcome>', DISCOVERY_OUTCOMES.join(' | '))
      .option('--bump-revision', 'Bump the revision (a material change)', false),
  ).action(
    (
      status: string,
      opts: CommonOptions & { run?: string; outcome?: string; bumpRevision?: boolean },
    ) => {
      const root = opts.projectRoot;
      const sessionId = session(root, opts);
      if (!isDiscoveryRunStatus(status)) {
        return fail(`"${status}" is not a valid run status`);
      }
      if (opts.outcome !== undefined && !isDiscoveryOutcome(opts.outcome)) {
        return fail(`"${opts.outcome}" is not a valid outcome`);
      }
      const dirName = resolveRun(root, sessionId, opts.run);
      if (dirName === null) {
        return fail('no Discovery run to update');
      }
      const updated = updateDiscoveryRun(root, dirName, {
        status,
        outcome: opts.outcome as never,
        bumpRevision: opts.bumpRevision,
      });
      console.log(JSON.stringify({ updated: updated !== null, run: dirName, status }));
    },
  );

  projectRootOption(
    discovery
      .command('report')
      .description('Generate the run’s read-only report.html from its canonical records')
      .option('--run <ref>', 'The run; defaults to the active run'),
  ).action((opts: CommonOptions & { run?: string }) => {
    const root = opts.projectRoot;
    const sessionId = session(root, opts);
    const dirName = resolveRun(root, sessionId, opts.run);
    if (dirName === null) {
      return fail('no Discovery run to report');
    }
    const path = writeDiscoveryReport(root, dirName);
    console.log(`**▸ paqad** · wrote ${path}`);
    console.log(JSON.stringify({ report: path }));
  });

  return discovery;
}

/** The `discovery <artifact> record <template.json>` writers, one subcommand per canonical artifact. */
function addRecordSubcommand(discovery: Command): void {
  const record = (name: string, help: string): Command =>
    projectRootOption(
      discovery
        .command(name)
        .description(help)
        .argument('<template>', 'Path to the filled JSON template')
        .option('--run <ref>', 'The run; defaults to the active run'),
    );

  const withRun = (
    opts: CommonOptions & { run?: string },
    templateFile: string,
    apply: (ctx: DiscoveryWriteContext, body: Record<string, unknown>) => void,
  ): void => {
    const root = opts.projectRoot;
    const sessionId = session(root, opts);
    const dirName = resolveRun(root, sessionId, opts.run);
    if (dirName === null) {
      return fail('no Discovery run — pass --run or start one first');
    }
    const body = loadTemplate(templateFile);
    if (body === null) {
      return fail(`template ${templateFile} is not a readable JSON object`);
    }
    apply(writeCtx(root, dirName, sessionId), body);
    console.log(JSON.stringify({ recorded: true, run: dirName }));
  };

  record('brief', 'Record the Understand-stage brief (brief.json)').action(
    (template: string, opts: CommonOptions & { run?: string }) =>
      withRun(opts, template, (ctx, body) => writeBrief(ctx, body as never)),
  );
  record('synthesis', 'Record the chief synthesis (synthesis.json)').action(
    (template: string, opts: CommonOptions & { run?: string }) =>
      withRun(opts, template, (ctx, body) => writeSynthesis(ctx, body as never)),
  );
  record('decisions', 'Record the Decide-stage decision index (decisions.json)').action(
    (template: string, opts: CommonOptions & { run?: string }) =>
      withRun(opts, template, (ctx, body) => writeDecisions(ctx, body as never)),
  );
  record('readiness', 'Record the readiness verdict (readiness.json)').action(
    (template: string, opts: CommonOptions & { run?: string }) =>
      withRun(opts, template, (ctx, body) => writeReadiness(ctx, body as never)),
  );
  record('handoff', 'Record the hand-off (handoff.json)').action(
    (template: string, opts: CommonOptions & { run?: string }) =>
      withRun(opts, template, (ctx, body) => writeHandoff(ctx, body as never)),
  );
  record('source', 'Append one research source (sources.jsonl)').action(
    (template: string, opts: CommonOptions & { run?: string }) =>
      withRun(opts, template, (ctx, body) => appendSource(ctx, body as never)),
  );
  record('contribution', 'Append one expert contribution (contributions.jsonl)').action(
    (template: string, opts: CommonOptions & { run?: string }) =>
      withRun(opts, template, (ctx, body) => appendContribution(ctx, body as never)),
  );
  record('blocker', 'Append one blocker (blockers.jsonl)').action(
    (template: string, opts: CommonOptions & { run?: string }) =>
      withRun(opts, template, (ctx, body) => appendBlocker(ctx, body as never)),
  );
  record('context', 'Record a stage-local context receipt (context-receipts.jsonl)').action(
    (template: string, opts: CommonOptions & { run?: string }) => {
      const root = opts.projectRoot;
      const sessionId = session(root, opts);
      const dirName = resolveRun(root, sessionId, opts.run);
      if (dirName === null) {
        return fail('no Discovery run — pass --run or start one first');
      }
      const body = loadTemplate(template);
      if (body === null) {
        return fail(`template ${template} is not a readable JSON object`);
      }
      const result = recordContextReceipt(writeCtx(root, dirName, sessionId), {
        stage: String(body.stage ?? ''),
        items: Array.isArray(body.items) ? (body.items as string[]) : [],
        mode: body.mode as never,
        reason: typeof body.reason === 'string' ? body.reason : null,
      });
      if (!result.ok) {
        return fail(result.error ?? 'context receipt refused');
      }
      console.log(JSON.stringify({ recorded: true, run: dirName }));
    },
  );
}
