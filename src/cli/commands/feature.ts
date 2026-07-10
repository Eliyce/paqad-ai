import { writeFileSync } from 'node:fs';

import { Command } from 'commander';

import { exportFeatureBundle, pruneFeatureBundles } from '@/feature-evidence/export.js';
import { resolveFeatureRef } from '@/feature-evidence/stage-ledger.js';
import { resolveSessionId } from '@/rag-ledger/session.js';

/**
 * `paqad-ai feature <export|prune>` (issue #339, Phase 7) — the per-feature export + the
 * retention policy. `export` hands an auditor one feature's whole bundle (every rigid
 * file, parsed) as a single self-contained JSON document; `prune` keeps the N most-recent
 * feature bundles and removes older ones, never touching a feature still active or paused.
 */
export function createFeatureCommand(): Command {
  const command = new Command('feature').description(
    'Export or prune per-feature evidence bundles',
  );

  command
    .command('export')
    .description('Export one feature bundle as a self-contained JSON document')
    .argument('<ref>', 'Feature ref (ULID, issue, slug, or dir name)')
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--session <id>', 'Session whose features the ref resolves against')
    .option('--out <file>', 'Write the export to a file instead of stdout')
    .action((ref: string, options: { projectRoot: string; session?: string; out?: string }) => {
      const sessionId = resolveSessionId(
        options.projectRoot,
        options.session ?? process.env.SE_SESSION ?? process.env.CLAUDE_SESSION_ID ?? null,
      );
      const dirName = resolveFeatureRef(options.projectRoot, sessionId, ref);
      if (!dirName) {
        console.error(`could not resolve feature "${ref}"`);
        process.exitCode = 1;
        return;
      }
      const bundle = exportFeatureBundle(options.projectRoot, dirName, new Date().toISOString());
      const json = `${JSON.stringify(bundle, null, 2)}\n`;
      if (options.out) {
        writeFileSync(options.out, json, 'utf8');
        console.log(JSON.stringify({ exported: true, feature: dirName, out: options.out }));
      } else {
        console.log(json);
      }
    });

  command
    .command('prune')
    .description('Retention: keep the N most-recent bundles, remove older non-live ones')
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--session <id>', 'Ignored (accepted for a uniform CLI interface)')
    .option('--keep <n>', 'How many non-live bundles to keep', '50')
    .action((options: { projectRoot: string; keep: string }) => {
      const keep = Number.parseInt(options.keep, 10);
      if (!Number.isInteger(keep) || keep < 0) {
        console.error(`--keep must be a non-negative integer (got "${options.keep}")`);
        process.exitCode = 1;
        return;
      }
      const result = pruneFeatureBundles(options.projectRoot, keep);
      console.log(
        `▸ paqad · pruned ${result.removed.length} old feature bundle${result.removed.length === 1 ? '' : 's'}`,
      );
      console.log(JSON.stringify({ removed: result.removed.length, kept: result.kept.length }));
    });

  return command;
}
