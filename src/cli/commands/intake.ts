import { Command } from 'commander';
import { execa } from 'execa';

import {
  GithubIssuesTicketProvider,
  type GhInvoke,
} from '@/providers/github-issues-ticket-provider.js';
import type { NormalizedTicket } from '@/providers/ticket-provider.js';
import { resolveSessionId } from '@/rag-ledger/session.js';
import { recordMarkedStage } from '@/stage-evidence/live-writer.js';

/** Tracker kind inferred from a ref's shape (deterministic, no config needed). */
export type IntakeRefKind = 'github-issues' | 'jira' | 'unknown';

/** Classify a ref by shape: `#123` → GitHub, `PROJ-123` → Jira. */
export function classifyRef(ref: string): IntakeRefKind {
  const trimmed = ref.trim();
  if (/^#?\d+$/.test(trimmed) || /^gh-\d+$/i.test(trimmed)) return 'github-issues';
  if (/^[A-Z][A-Z0-9]+-\d+$/.test(trimmed)) return 'jira';
  return 'unknown';
}

/** Render a normalized ticket as a compact, human-readable block. */
export function renderTicket(ticket: NormalizedTicket): string {
  const ac =
    ticket.acceptance_criteria.length > 0
      ? '\n' + ticket.acceptance_criteria.map((c) => `  - ${c}`).join('\n')
      : ' (none detected)';
  return [
    `**▸ paqad** · fetched ${ticket.id} — building what it actually says`,
    `> **${ticket.title}** [${ticket.status}] (${ticket.type})`,
    `> ${ticket.url}`,
    ``,
    `Acceptance criteria:${ac}`,
    ``,
    ticket.description || '(no description)',
  ].join('\n');
}

export interface IntakeFetchResult {
  exitCode: number;
  output: string;
}

export interface IntakeFetchDeps {
  /** Injected `gh` runner (args -> stdout) so the fetch is testable without a live gh. */
  ghInvoke: GhInvoke;
  projectRoot: string;
  sessionId?: string | null;
  /** Record the optional ticket_intake stage row (best-effort). Injected for tests. */
  recordStage?: (stage: string, phase: 'start' | 'end') => void;
}

/**
 * The testable core of `paqad-ai intake fetch <ref>`: classify the ref, fetch via the
 * matching provider, and return the rendered ticket + exit code. GitHub is the
 * shell-driven path (`gh`); Jira/unknown degrade to a clear message (Jira intake runs
 * through the Atlassian MCP in-session, which a CLI cannot invoke). Never throws — a
 * fetch failure returns a non-zero exit with the reason, so the caller reports it.
 */
export async function runIntakeFetch(
  ref: string,
  deps: IntakeFetchDeps,
): Promise<IntakeFetchResult> {
  const kind = classifyRef(ref);
  if (kind === 'jira') {
    return {
      exitCode: 0,
      output:
        `**▸ paqad** · ${ref} looks like a Jira ticket\n` +
        `> Jira intake runs through the Atlassian MCP in your session — fetch ${ref} via the ` +
        `MCP and ground the spec in it. (The CLI drives GitHub issues directly; Jira is MCP-only.)`,
    };
  }
  if (kind === 'unknown') {
    return {
      exitCode: 1,
      output:
        `**▸ paqad** · could not recognise "${ref}" as a ticket reference\n` +
        `> Use a GitHub issue (\`#123\`) or a Jira key (\`PROJ-123\`).`,
    };
  }

  let ticket: NormalizedTicket;
  try {
    ticket = await new GithubIssuesTicketProvider(deps.ghInvoke).fetchTicket(ref);
  } catch (error) {
    return {
      exitCode: 1,
      output:
        `**▸ paqad** · couldn't fetch ${ref} from GitHub\n` +
        `> ${error instanceof Error ? error.message : String(error)}\n` +
        `> Is \`gh\` installed and authenticated (\`gh auth status\`)?`,
    };
  }

  // Optional ticket_intake stage row (a bookend — never blocks). Best-effort.
  deps.recordStage?.('ticket_intake', 'start');
  deps.recordStage?.('ticket_intake', 'end');
  return { exitCode: 0, output: renderTicket(ticket) };
}

/**
 * `paqad-ai intake fetch <ref>` (issue #322) — the deterministic front door of the
 * ticket → PR loop. Pulls the REAL ticket so the spec grounds in its actual text
 * instead of a guess from the id. Optional bookend: it never blocks a change.
 */
export function createIntakeCommand(): Command {
  const intake = new Command('intake').description(
    'Deterministic ticket intake — fetch the real ticket a request references (issue #322)',
  );

  intake
    .command('fetch')
    .description('Fetch a ticket by ref (GitHub `#123` via gh; Jira `PROJ-123` via MCP in-session)')
    .argument('<ref>', 'Ticket reference, e.g. #45 or PQD-123')
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--session <id>', 'Session id for the optional ticket_intake stage row')
    .action(async (ref: string, options: { projectRoot: string; session?: string }) => {
      const projectRoot = options.projectRoot;
      const sessionId = resolveSessionId(
        projectRoot,
        options.session ?? process.env.SE_SESSION ?? process.env.CLAUDE_SESSION_ID ?? null,
      );
      const ghInvoke: GhInvoke = async (args) => {
        const result = await execa('gh', args, { cwd: projectRoot, reject: false });
        if (result.exitCode !== 0) {
          throw new Error(result.stderr || `gh exited ${result.exitCode}`);
        }
        return result.stdout ?? '';
      };
      const result = await runIntakeFetch(ref, {
        ghInvoke,
        projectRoot,
        sessionId,
        recordStage: (stage, phase) => {
          try {
            recordMarkedStage(projectRoot, { sessionId, stage, phase });
          } catch {
            /* best-effort: intake is optional, its ledger row never blocks */
          }
        },
      });
      if (result.exitCode === 0) {
        console.log(result.output);
      } else {
        console.error(result.output);
        process.exitCode = result.exitCode;
      }
    });

  return intake;
}
