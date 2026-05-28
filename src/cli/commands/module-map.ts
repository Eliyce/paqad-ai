// `paqad-ai module-map` — reconcile module-map.yml against the source tree.
// Issue #80, Phase 2. Writes .paqad/module-map/drift.json and prints a JSON
// summary on stdout. Hard-fails (non-zero exit) when source_roots is missing
// and --fail-on-drift is set.

import { Command } from 'commander';

import {
  driftReportHasFindings,
  reconcileModuleMap,
} from '@/module-map/reconciler.js';

export function createModuleMapCommand(): Command {
  const command = new Command('module-map').description(
    'Reconcile module-map.yml against the source tree (issue #80 Phase 2)',
  );

  command
    .command('reconcile')
    .description(
      'Scan source_roots, compare to module-map.yml and docs/modules/, write .paqad/module-map/drift.json',
    )
    .option('--project-root <path>', 'Project root', process.cwd())
    .option(
      '--source-roots <roots>',
      'Comma-separated source roots (overrides stack-pack discovery; required when none provided)',
    )
    .option(
      '--file-extensions <exts>',
      'Comma-separated file extensions to include (e.g. ".ts,.tsx"). Defaults to all files.',
    )
    .option('--no-write', 'Skip writing .paqad/module-map/drift.json')
    .option('--fail-on-drift', 'Exit non-zero when findings are present', false)
    .option('--json', 'Emit JSON (default human-readable summary)', false)
    .action(
      async (options: {
        projectRoot: string;
        sourceRoots?: string;
        fileExtensions?: string;
        write: boolean;
        failOnDrift: boolean;
        json: boolean;
      }) => {
        const sourceRoots =
          options.sourceRoots !== undefined
            ? options.sourceRoots.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
            : null;
        const fileExtensions =
          options.fileExtensions !== undefined
            ? options.fileExtensions
                .split(',')
                .map((s) => s.trim())
                .filter((s) => s.length > 0)
            : undefined;

        const report = await reconcileModuleMap({
          projectRoot: options.projectRoot,
          sourceRoots,
          fileExtensions,
          writeReport: options.write,
        });

        if (options.json) {
          console.log(JSON.stringify(report, null, 2));
        } else if (report.blocked !== null) {
          console.error(`Reconciler blocked: ${report.blocked}.`);
          console.error('Add module_health.source_roots to the active stack pack and retry.');
        } else if (report.findings.length === 0) {
          console.log('No module-map drift detected.');
        } else {
          console.log(`Found ${report.findings.length} drift finding(s):`);
          for (const [code, n] of Object.entries(report.counts)) {
            if (n > 0) console.log(`  ${code}: ${n}`);
          }
        }

        if (options.failOnDrift && driftReportHasFindings(report)) {
          process.exitCode = 1;
        }
      },
    );

  return command;
}
