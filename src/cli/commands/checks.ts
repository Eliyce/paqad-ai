import { Command } from 'commander';

import { loadChangeEvidence } from '@/pipeline/change-evidence.js';
import { runChecks } from '@/checks/run-checks.js';
import { writeChecksReport, CHECKS_REPORT_SCHEMA_VERSION } from '@/checks/report-store.js';

/**
 * `paqad-ai checks run` — the deterministic checks stage (issue #318). The agent
 * invokes it mid-turn (like `paqad-ai stage`): it resolves the project's mapped
 * format/test/build commands, runs them, and persists one structured result per
 * command so the completion backstop can prove the checks ran instead of assuming
 * they passed. A red command exits the verb non-zero — nothing here is a trust
 * fall-through. No LLM is involved: a command's exit code is the verdict.
 */
export function createChecksCommand(): Command {
  const command = new Command('checks').description(
    'Run the project format/test/build checks deterministically and record the result',
  );

  command
    .command('run')
    .description('Run the mapped checks, persist the structured report, and block on failure')
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--silent', 'Suppress the machine-readable summary line', false)
    .action(async (options: { projectRoot: string; silent: boolean }) => {
      const changedFiles = (await loadChangeEvidence(options.projectRoot)).files;
      const result = await runChecks({ projectRoot: options.projectRoot, changedFiles });

      writeChecksReport(options.projectRoot, {
        schema_version: CHECKS_REPORT_SCHEMA_VERSION,
        generated_at: new Date().toISOString(),
        passed: result.passed,
        ran: result.ran,
        results: result.results,
      });

      for (const warning of result.warnings) {
        console.error(`⚠️  ${warning}`);
      }

      if (!result.ran) {
        // Nothing to run (no mapped commands) — Inconclusive, never a vacuous pass.
        console.log('**▸ paqad** · no checks mapped — Inconclusive');
        console.log('> ⚪ No format/test/build command is mapped in the project profile.');
        if (!options.silent) console.log(JSON.stringify({ ran: false, passed: null }));
        return;
      }

      if (result.passed) {
        console.log('**▸ paqad** · checks green — Safe to merge');
        for (const outcome of result.outcomes) {
          console.log(`> 🟢 ${outcome.logical_command ?? outcome.command} passed`);
        }
      } else {
        console.log('**▸ paqad** · checks failed — Needs your attention');
        for (const outcome of result.outcomes) {
          const glyph = outcome.passed ? '🟢' : '🔴';
          console.log(
            `> ${glyph} ${outcome.logical_command ?? outcome.command}` +
              (outcome.passed ? ' passed' : ` failed (exit ${outcome.exit_code})`),
          );
        }
        process.exitCode = 1;
      }

      if (!options.silent) {
        console.log(JSON.stringify({ ran: true, passed: result.passed }));
      }
    });

  return command;
}
