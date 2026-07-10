import { Command } from 'commander';

import { resumeFeatureByRef } from '@/feature-evidence/stage-ledger.js';
import { resolveSessionId } from '@/rag-ledger/session.js';

interface ResumeOptions {
  projectRoot: string;
  session?: string;
  feature: string;
}

/**
 * `paqad-ai resume --feature <ref>` — reactivate a paused feature (issue #339). A
 * detour to another feature or a question pauses the active feature onto the session's
 * paused stack; this pops the one the `<ref>` names (its ULID, issue, slug, or full dir
 * name) back to active so the next stage/edit attaches to it again. Resolves the SAME
 * session the recorder + block-forward gate key on, so a resume actually redirects the
 * live change. A ref that matches no known feature exits non-zero.
 */
export function createResumeCommand(): Command {
  return new Command('resume')
    .description('Reactivate a paused feature-development change by ref (ULID / issue / slug)')
    .requiredOption(
      '--feature <ref>',
      'The paused feature to resume (ULID, issue, slug, or dir name)',
    )
    .option('--project-root <path>', 'Project root', process.cwd())
    .option(
      '--session <id>',
      'Session id to resume under (defaults to SE_SESSION / CLAUDE_SESSION_ID, then the shared ledger-session cache)',
    )
    .action((options: ResumeOptions) => {
      const root = options.projectRoot;
      const sessionId = resolveSessionId(
        root,
        options.session ?? process.env.SE_SESSION ?? process.env.CLAUDE_SESSION_ID ?? null,
      );
      const resumed = resumeFeatureByRef(root, sessionId, options.feature);
      if (!resumed) {
        console.error(
          `could not resume "${options.feature}" — no paused feature matches that ref.`,
        );
        process.exitCode = 1;
        return;
      }
      console.log(`▸ paqad · resumed ${resumed}`);
      // Machine-readable confirmation. Deliberately omits the resolved session id
      // (environment-tainted; echoing it is flagged as clear-text logging, CodeQL
      // js/clear-text-logging) — the caller already knows its own session.
      console.log(JSON.stringify({ resumed: true, feature: resumed }));
    });
}
