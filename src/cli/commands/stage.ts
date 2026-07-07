import { Command } from 'commander';

import { STAGE_ORDER } from '@/pipeline/feature-development-policy.js';
import { resolveSessionId } from '@/rag-ledger/session.js';
import { recordMarkedStage } from '@/stage-evidence/live-writer.js';
import { markerNarrationLine } from '@/stage-evidence/narration.js';

/**
 * `paqad-ai stage <start|end> <stage>` — the shell escape hatch that marks a
 * feature-development stage in the stage-evidence ledger (issue #307). This is the
 * entry point the block-forward gate's remediation names: unlike a project-local
 * script it resolves from the installed package on EVERY onboarded project. The row
 * is script-minted (clock + validation inside the recorder); the caller supplies
 * only the boundary token. Narration and ledger are both non-negotiable: a
 * successful mark always prints the `▸ paqad` line alongside the row.
 */
export function createStageCommand(): Command {
  return new Command('stage')
    .description(
      'Mark a feature-development stage boundary in the stage-evidence ledger ' +
        '(clears the pre-code block for planning/specification)',
    )
    .argument('<phase>', "'start' or 'end'")
    .argument('<stage>', `one of: ${STAGE_ORDER.join(', ')}`)
    .option('--project-root <path>', 'Project root', process.cwd())
    .option(
      '--session <id>',
      'Session id to record under (defaults to SE_SESSION / CLAUDE_SESSION_ID, then the shared ledger-session cache)',
    )
    .action((phase: string, stage: string, options: { projectRoot: string; session?: string }) => {
      if (phase !== 'start' && phase !== 'end') {
        console.error(`unknown phase "${phase}" — use 'start' or 'end'`);
        process.exitCode = 1;
        return;
      }
      const root = options.projectRoot;
      // Resolve the SAME session the live writer + block-forward gate key on (the
      // single-slot ledger-session cache) so a manual mark actually clears the
      // pre-mutation block in the session that hit it.
      const sessionId = resolveSessionId(
        root,
        options.session ?? process.env.SE_SESSION ?? process.env.CLAUDE_SESSION_ID ?? null,
      );
      const recorded = recordMarkedStage(root, { sessionId, stage, phase });
      if (!recorded) {
        console.error(
          `could not record "${stage} ${phase}" — unknown stage or out-of-order boundary. ` +
            `Stages, in order: ${STAGE_ORDER.join(', ')}`,
        );
        process.exitCode = 1;
        return;
      }
      const line = markerNarrationLine(stage, phase);
      if (line) console.log(line);
      // Machine-readable confirmation of the recording. Deliberately omits the
      // resolved session id: it is derived from the environment (SE_SESSION /
      // CLAUDE_SESSION_ID) and echoing environment-tainted data to stdout is
      // flagged as clear-text logging of sensitive information (CodeQL
      // js/clear-text-logging). The caller already knows its own session.
      console.log(JSON.stringify({ recorded: true, stage, phase }));
    });
}
