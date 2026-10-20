import { Command } from 'commander';
import { execa } from 'execa';

import {
  GithubIssuesTicketProvider,
  type GhInvoke,
} from '@/providers/github-issues-ticket-provider.js';
import type { NormalizedTicket } from '@/providers/ticket-provider.js';
import { resolveSessionId } from '@/rag-ledger/session.js';
import { recordMarkedStage } from '@/stage-evidence/live-writer.js';

export type IntakeRefKind = 'github-issues' | 'jira' | 'unknown';

export function classifyRef(ref: string): IntakeRefKind {
  const trimmed = ref.trim();
  if (/^#?\d+$/.test(trimmed) || /^gh-\d+$/i.test(trimmed)) return 'github-issues';
  if (/^[A-Z][A-Z0-9]+-\d+$/.test(trimmed)) return 'jira';
  return 'unknown';
}

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
  ghInvoke: GhInvoke;
  projectRoot: string;
  sessionId?: string | null;
  recordStage?: (stage: string, phase: 'start' | 'end') => void;
}

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
        `> Use a GitHub issue (\`#<number>\`) or a Jira key (\`PROJ-<number>\`).`,
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

  deps.recordStage?.('ticket_intake', 'start');
  deps.recordStage?.('ticket_intake', 'end');
  return { exitCode: 0, output: renderTicket(ticket) };
}

export function createIntakeCommand(): Command {
  const intake = new Command('intake').description(
    'Deterministic ticket intake — fetch the real ticket a request references',
  );

  intake
    .command('fetch')
    .description(
      'Fetch a ticket by ref (GitHub `#<number>` via gh; Jira `PROJ-<number>` via MCP in-session)',
    )
    .argument('<ref>', 'Ticket reference, e.g. #<number> or PQD-<number>')
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
          } catch {}
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
