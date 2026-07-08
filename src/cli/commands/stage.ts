import { Command } from 'commander';

import { STAGE_ORDER } from '@/pipeline/feature-development-policy.js';
import { resolveSessionId } from '@/rag-ledger/session.js';
import { recordMarkedStage } from '@/stage-evidence/live-writer.js';
import { markerNarrationLine } from '@/stage-evidence/narration.js';

/** Accumulate a repeatable `--artifact <path>` option into an array. */
function collectArtifact(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

interface StageOptions {
  projectRoot: string;
  session?: string;
  artifact?: string[];
}

/**
 * `paqad-ai stage <start|end> <stage>` — the shell escape hatch that marks a
 * feature-development stage in the stage-evidence ledger (issue #307). This is the
 * entry point the block-forward gate's remediation names: unlike a project-local
 * script it resolves from the installed package on EVERY onboarded project. The row
 * is script-minted (clock + validation inside the recorder); the caller supplies
 * only the boundary token. Narration and ledger are both non-negotiable: a
 * successful mark always prints the `▸ paqad` line alongside the row.
 *
 * A stage-end may carry `--artifact <path>` (repeatable): the recorder hashes the
 * artifact's real on-disk bytes into `artifact_digest` (issue #320), so a thinking
 * stage (planning/specification/review) proves it produced work rather than just
 * printing a marker. This mirrors the `paqad:stage <stage> end -- <path>` marker.
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
    .option(
      '--artifact <path>',
      'Artifact the stage produced (repeatable); its real on-disk bytes are hashed so a ' +
        'thinking stage (planning/specification/review) proves work, not just a claim',
      collectArtifact,
    )
    .action((phase: string, stage: string, options: StageOptions) => {
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
      const recorded = recordMarkedStage(root, {
        sessionId,
        stage,
        phase,
        // Artifacts are only meaningful on an `end`; a `start` ignores them.
        artifactPaths: phase === 'end' ? options.artifact : undefined,
      });
      if (!recorded) {
        // Only an UNKNOWN stage fails now (issue #310): an out-of-order boundary is
        // recorded, not rejected, so the pre-code stages can always be marked — the
        // fold's ordering check is the single, non-destructive judge of order.
        console.error(
          `could not record "${stage} ${phase}" — unknown stage "${stage}". ` +
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
