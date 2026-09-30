import { Command } from 'commander';

import { readChangeConstants } from '@/feature-evidence/feature-record.js';
import { laneRank } from '@/feature-evidence/lane-rank.js';
import { currentFeature, recordChangeConstants } from '@/feature-evidence/stage-ledger.js';
import type { FeatureLane } from '@/feature-evidence/types.js';
import { resolveSessionId } from '@/rag-ledger/session.js';

/** The lanes an operator may set, in the canonical order. */
const SETTABLE_LANES: readonly Exclude<FeatureLane, null>[] = ['fast', 'graduated', 'full'];

interface LaneOptions {
  projectRoot: string;
  session?: string;
}

/**
 * `paqad-ai lane set <fast|graduated|full>` — the operator lane override (issue #602, FR-1).
 *
 * The automatic classifier decides a lane from the first message, before it has read the
 * ticket, and until now nothing could correct it — a wrong "small" (or missing) guess silently
 * switched the stage-isolation check off. This verb lets the person or AI doing the work record
 * the real lane on the active change's `feature.json`, which is exactly what the end-of-change
 * isolation check reads.
 *
 * It goes through the same monotonic ratchet as every other lane write (FR-3): it RAISES the
 * lane, and a downgrade request leaves the recorded lane untouched and reports that the
 * downgrade was refused — the safeguard only ever fails toward more scrutiny, never less.
 */
export function createLaneCommand(): Command {
  const command = new Command('lane').description(
    'Set or show the lane for the active feature-development change (issue #602)',
  );

  command
    .command('set')
    .description('Set (raise) the lane the end-of-change isolation check reads for this change')
    .argument('<lane>', `one of: ${SETTABLE_LANES.join(', ')}`)
    .option('--project-root <path>', 'Project root', process.cwd())
    .option(
      '--session <id>',
      'Session id (defaults to SE_SESSION / CLAUDE_SESSION_ID, then the shared ledger-session cache)',
    )
    .action((lane: string, options: LaneOptions) => {
      if (!SETTABLE_LANES.includes(lane as Exclude<FeatureLane, null>)) {
        console.error(`unknown lane "${lane}" — one of: ${SETTABLE_LANES.join(', ')}`);
        process.exitCode = 1;
        return;
      }
      const requested = lane as Exclude<FeatureLane, null>;
      const root = options.projectRoot;
      const sessionHint =
        options.session ?? process.env.SE_SESSION ?? process.env.CLAUDE_SESSION_ID ?? null;
      const sessionId = resolveSessionId(root, sessionHint);
      const dirName = currentFeature(root, sessionId);
      if (!dirName) {
        console.error('no active feature — run `paqad-ai stage start planning` first');
        process.exitCode = 1;
        return;
      }

      const before = readChangeConstants(root, dirName).lane;
      // The write ratchets (updateFeatureRecord holds INV-1), so this only ever raises the lane.
      recordChangeConstants(root, dirName, { lane: requested });
      const after = readChangeConstants(root, dirName).lane;

      const changed = after !== before;
      const refusedDowngrade = !changed && laneRank(requested) < laneRank(before);
      if (changed) {
        console.log(`**▸ paqad** · lane raised to ${after} — the isolation check reads this now.`);
      } else if (refusedDowngrade) {
        console.log(
          `**▸ paqad** · kept the lane at ${before} — a change's lane only ever rises, so it ` +
            `won't be downgraded to ${requested}.`,
        );
      } else {
        console.log(`**▸ paqad** · lane already ${after} — nothing to change.`);
      }
      console.log(
        JSON.stringify({
          set: true,
          lane: after,
          requested,
          changed,
          refused_downgrade: refusedDowngrade,
        }),
      );
    });

  command
    .command('show')
    .description('Show the lane recorded for the active change')
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--session <id>', 'Session id (defaults to SE_SESSION / CLAUDE_SESSION_ID)')
    .action((options: LaneOptions) => {
      const root = options.projectRoot;
      const sessionHint =
        options.session ?? process.env.SE_SESSION ?? process.env.CLAUDE_SESSION_ID ?? null;
      const sessionId = resolveSessionId(root, sessionHint);
      const dirName = currentFeature(root, sessionId);
      if (!dirName) {
        console.error('no active feature — run `paqad-ai stage start planning` first');
        process.exitCode = 1;
        return;
      }
      const lane = readChangeConstants(root, dirName).lane;
      console.log(JSON.stringify({ lane }));
    });

  return command;
}
