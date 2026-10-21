import { Command } from 'commander';

import { loadChangeEvidence } from '@/pipeline/change-evidence.js';
import { runDuplicationScan } from '@/duplication/scan.js';
import type { DuplicationFinding } from '@/duplication/types.js';

export function createDuplicationCommand(): Command {
  const command = new Command('duplication').description(
    'Flag new code that near-copies existing helpers (new-code-only, deterministic)',
  );

  command
    .command('scan')
    .description('Scan the changed files for near-duplication of existing code and record a report')
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--json', 'Emit the machine-readable report instead of the human summary', false)
    .option('--no-corroborate', 'Skip the optional jscpd corroboration pass')
    .action(async (options: { projectRoot: string; json: boolean; corroborate: boolean }) => {
      const changedFiles = (await loadChangeEvidence(options.projectRoot)).files;
      const report = await runDuplicationScan({
        projectRoot: options.projectRoot,
        changedFiles,
        corroborate: options.corroborate,
      });

      if (options.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        printSummary(report.findings, report.blocking);
      }

      if (report.blocking) {
        process.exitCode = 1;
      }
    });

  return command;
}

function printSummary(findings: DuplicationFinding[], blocking: boolean): void {
  if (findings.length === 0) {
    console.log('**▸ paqad** · duplication: 🟢 no new near-copies of existing code');
    return;
  }
  const verb = blocking ? 'Needs your attention' : 'Heads up';
  const glyph = blocking ? '🔴' : '🟡';
  console.log(`**▸ paqad** · ${verb}`);
  console.log(
    blocking
      ? '> I caught new code that near-copies existing helpers before it could ship:'
      : '> New code near-copies existing helpers (not blocking):',
  );
  for (const finding of findings.slice(0, 20)) {
    console.log(`> - ${glyph} ${finding.message}`);
  }
  /* c8 ignore start -- display-only truncation past 20 findings; a single change rarely
     introduces that many near-copies, so this line is not worth a 21-fixture test. */
  if (findings.length > 20) {
    console.log(`> - …and ${findings.length - 20} more`);
    /* c8 ignore stop */
  }
}
