import { resolve } from 'node:path';

import { Command } from 'commander';

import { foldAnalyticsTagSession } from '@/analytics-tag/fold.js';
import { recordAnalyticsTag } from '@/analytics-tag/recorder.js';
import { reconcileAnalyticsMap } from '@/analytics-tag/registry.js';
import { resolveSessionId } from '@/rag-ledger/session.js';
import type { AnalyticsTagSessionFold } from '@/analytics-tag/types.js';

/** Render the session fold as a lean paqad-voice summary. */
function renderSummary(fold: AnalyticsTagSessionFold): string {
  const { totals } = fold;
  const lines = [
    `**▸ paqad** · analytics tags for session ${fold.session_id}`,
    `> What the analytics agent actually wrote this session (recorded by script, not claimed by the model).`,
    `> - tags written: ${totals.tag_added_count} · distinct: ${totals.distinct_tags} · providers: ${totals.providers.join(', ') || 'none'}`,
  ];
  for (const tag of fold.tags) {
    lines.push(
      `> - ${tag.tag_name} (${tag.tag_provider ?? 'unknown'}) → ${tag.source_path ?? 'unknown'} ×${tag.occurrences}`,
    );
  }
  lines.push(
    `> Proof of occurrence, not of benefit: this records that a tag was written, not that the event fired.`,
  );
  return `${lines.join('\n')}\n`;
}

interface ShowOptions {
  session?: string;
  format: string;
  projectRoot: string;
}

interface MapOptions {
  format: string;
  projectRoot: string;
}

interface RecordOptions {
  session?: string;
  adapter: string;
  provider?: string;
  source?: string;
  note?: string;
  projectRoot: string;
}

/**
 * `paqad-ai analytics` — read (`show`), reconcile the tracking map (`map`), and low-level
 * write (`record`) of the script-written analytics-tag ledger (issue #241). `record` exists
 * for the runtime seams on hookless providers; it is never for hand-authoring evidence, and
 * it only lands a row when analytics instrumentation is enabled.
 */
export function createAnalyticsCommand(): Command {
  const command = new Command('analytics').description(
    'Read, reconcile, or record the script-written analytics-tag ledger (issue #241)',
  );

  command
    .command('show')
    .description('Fold a session into a tag rollup (paqad-voice or JSON)')
    .requiredOption('--session <id>', 'Session id to fold')
    .option('--format <fmt>', 'Output format: summary | json', 'summary')
    .option('--project-root <path>', 'Project root', process.cwd())
    .action((options: ShowOptions) => {
      const fmt = options.format.toLowerCase();
      if (fmt !== 'summary' && fmt !== 'json') {
        process.stderr.write(`error: invalid --format '${options.format}' (summary|json)\n`);
        process.exitCode = 2;
        return;
      }
      const fold = foldAnalyticsTagSession(resolve(options.projectRoot), options.session as string);
      process.stdout.write(
        fmt === 'json' ? `${JSON.stringify(fold, null, 2)}\n` : renderSummary(fold),
      );
    });

  command
    .command('map')
    .description('Reconcile the tracking-map registry from the ledger (preserves the preamble)')
    .option('--format <fmt>', 'Output format: summary | json', 'summary')
    .option('--project-root <path>', 'Project root', process.cwd())
    .action((options: MapOptions) => {
      const result = reconcileAnalyticsMap(resolve(options.projectRoot));
      if (options.format.toLowerCase() === 'json') {
        process.stdout.write(
          `${JSON.stringify({ path: result.path, tags: result.tagCount }, null, 2)}\n`,
        );
        return;
      }
      process.stdout.write(
        `**▸ paqad** · analytics tracking map reconciled\n> Wrote ${result.path} from ${result.tagCount} recorded tag(s).\n`,
      );
    });

  command
    .command('record')
    .description('Record one tag write (script-only; used by the runtime seams, not hand-authored)')
    .argument('<tag-name>', 'The event/tag name written')
    .option('--session <id>', 'Session id (host hint; minted/cached when absent)')
    .option('--adapter <name>', 'Provider adapter', 'claude-code')
    .option('--provider <id>', 'Analytics provider (ga4, segment, posthog, …)')
    .option('--source <path>', 'File the tag was written into')
    .option('--note <text>', 'Optional free text (redacted, excluded from the hash)')
    .option('--project-root <path>', 'Project root', process.cwd())
    .action((tagName: string, options: RecordOptions) => {
      const projectRoot = resolve(options.projectRoot);
      recordAnalyticsTag(
        projectRoot,
        {
          tagName,
          tagProvider: options.provider ?? null,
          sourcePath: options.source ?? null,
          note: options.note ?? null,
        },
        {
          sessionId: resolveSessionId(projectRoot, options.session),
          adapter: options.adapter,
          // The seam only calls this when the flag is on; the CLI mirrors that intent.
          analyticsEnabled: true,
        },
      );
    });

  return command;
}
