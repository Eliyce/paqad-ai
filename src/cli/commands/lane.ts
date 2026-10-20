import { Command } from 'commander';

import { readChangeConstants } from '@/feature-evidence/feature-record.js';
import { laneRank } from '@/feature-evidence/lane-rank.js';
import { currentFeature, recordChangeConstants } from '@/feature-evidence/stage-ledger.js';
import type { FeatureLane } from '@/feature-evidence/types.js';
import { resolveSessionId } from '@/rag-ledger/session.js';

const SETTABLE_LANES: readonly Exclude<FeatureLane, null>[] = ['fast', 'graduated', 'full'];

interface LaneOptions {
  projectRoot: string;
  session?: string;
}

export function createLaneCommand(): Command {
  const command = new Command('lane').description(
    'Set or show the lane for the active feature-development change',
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
