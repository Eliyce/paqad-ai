import { Command } from 'commander';

import { currentFeature } from '@/feature-evidence/stage-ledger.js';
import type { FixProofPhase } from '@/fix-protocol/fix-proof-record.js';
import { DEFAULT_PROOF_TIMEOUT_MS, proveFix } from '@/fix-protocol/fix-prove.js';
import { resolveSessionId } from '@/rag-ledger/session.js';

const PHASES: readonly FixProofPhase[] = ['red', 'green'];

interface FixProveOptions {
  testFile: string;
  testId: string;
  command: string;
  timeout?: string;
  projectRoot: string;
  session?: string;
  silent: boolean;
}

const OUTCOME_LINE: Record<string, string> = {
  red: '🔴 red recorded: the proof fails before the fix',
  'not-reproduced': '🟡 not reproduced: the proof passed before the fix',
  green: '🟢 green recorded: the proof passes after the fix',
  'still-failing': '🔴 still failing: the proof does not pass yet',
  held: '🟡 held: the fix broke a check that passed before',
  error: '⚪ not counted: the proof command did not give a usable result',
};

function timeoutMs(raw: string | undefined): number | null {
  if (raw === undefined) return DEFAULT_PROOF_TIMEOUT_MS;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : null;
}

export function createFixCommand(): Command {
  const command = new Command('fix').description(
    'Prove a fix: record the failing test before the fix and the passing test after it',
  );

  command
    .command('prove')
    .description(
      'Run the proof test and record the result in fix-proof.json; red runs before the fix ' +
        'lands, green after it',
    )
    .argument('<phase>', `one of: ${PHASES.join(', ')}`)
    .requiredOption('--test-file <path>', 'Test file holding the proof test')
    .requiredOption('--test-id <id>', 'Name of the proof test, as the runner prints it')
    .requiredOption('--command <cmd>', 'Command that runs the proof test')
    .option('--timeout <seconds>', 'Stop the proof command after this many seconds (600)')
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--session <id>', 'Session id (defaults to SE_SESSION / CLAUDE_SESSION_ID)')
    .option('--silent', 'Suppress the machine-readable summary line', false)
    .action(async (phase: string, options: FixProveOptions) => {
      if (!PHASES.includes(phase as FixProofPhase)) {
        console.error(`unknown phase "${phase}" — one of: ${PHASES.join(', ')}`);
        process.exitCode = 1;
        return;
      }
      const limit = timeoutMs(options.timeout);
      if (limit === null) {
        console.error(`--timeout must be a positive number of seconds, got "${options.timeout}"`);
        process.exitCode = 1;
        return;
      }
      const root = options.projectRoot;
      const sessionId = resolveSessionId(
        root,
        options.session ?? process.env.SE_SESSION ?? process.env.CLAUDE_SESSION_ID ?? null,
      );
      const dirName = currentFeature(root, sessionId);
      if (!dirName) {
        console.error('no active feature — run `paqad-ai stage start planning` first');
        process.exitCode = 1;
        return;
      }
      const row = await proveFix({
        projectRoot: root,
        dirName,
        sessionId,
        phase: phase as FixProofPhase,
        testFile: options.testFile,
        testId: options.testId,
        command: options.command,
        timeoutMs: limit,
      });
      console.log(`**▸ paqad** · fix proof ${phase}`);
      console.log(`> ${OUTCOME_LINE[row.outcome]}`);
      console.log(`> ${row.reason}`);
      if (row.outcome === 'error') process.exitCode = 1;
      if (!options.silent) {
        console.log(
          JSON.stringify({
            recorded: true,
            phase: row.phase,
            outcome: row.outcome,
            exit_code: row.exit_code,
            duration_ms: row.duration_ms,
          }),
        );
      }
    });

  return command;
}
