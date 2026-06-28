import { resolve } from 'node:path';

import { Command } from 'commander';

import { foldRagEvidenceSession } from '@/rag-ledger/fold.js';
import { openRagConversation, recordRagEvidence } from '@/rag-ledger/recorder.js';
import { resolveSessionId } from '@/rag-ledger/session.js';
import type { RagEvidenceFields } from '@/rag-ledger/recorder.js';
import type { RagEvidenceKind, RagEvidenceSessionFold } from '@/rag-ledger/types.js';

const RECORD_KINDS: RagEvidenceKind[] = [
  'open',
  'refreshed',
  'called',
  'used',
  'fallback',
  'close',
];

/** Render the session fold as a lean paqad-voice summary. */
function renderSummary(fold: RagEvidenceSessionFold): string {
  const { totals, coverage } = fold;
  const usedRate =
    coverage.prompts_total === 0
      ? 'n/a'
      : `${Math.round((coverage.prompts_with_rag / coverage.prompts_total) * 100)}%`;
  const reasons = Object.entries(coverage.fallback_reasons)
    .map(([reason, count]) => `${reason}×${count}`)
    .join(', ');
  const lines = [
    `**▸ paqad** · RAG evidence for session ${fold.session_id}`,
    `> What the RAG layer actually did this session (recorded by script, not claimed by the model).`,
    `> - prompts: ${coverage.prompts_total} (${coverage.prompts_with_rag} used RAG, ${coverage.prompts_fallback} fell back to grep) — use rate ${usedRate}`,
    `> - refreshes: ${totals.refresh_count} · retrieval calls: ${totals.called_count} · injected: ${totals.used_count} · fallbacks: ${totals.fallback_count}`,
  ];
  if (reasons) {
    lines.push(`> - fallback reasons: ${reasons}`);
  }
  lines.push(
    `> Proof of occurrence, not of benefit: this records that slices were injected, not that the model used them.`,
  );
  return `${lines.join('\n')}\n`;
}

interface ShowOptions {
  session?: string;
  format: string;
  projectRoot: string;
}

interface RecordOptions {
  session?: string;
  adapter: string;
  ragEnabled: boolean;
  ordinal?: string;
  open: boolean;
  json?: string;
  projectRoot: string;
}

/**
 * `paqad-ai rag-evidence` — read (`show`) and low-level write (`record`) of the
 * script-written RAG-evidence ledger (issue #249). `record` exists for the runtime
 * seams (background worker, prompt hook) on hookless providers; it is never for
 * hand-authoring evidence — the ledger is script-only.
 */
export function createRagEvidenceCommand(): Command {
  const command = new Command('rag-evidence').description(
    'Read or record the script-written RAG-evidence ledger (refresh / call / use / fallback)',
  );

  command
    .command('show')
    .description('Fold a session into a use-rate / fallback rollup (paqad-voice or JSON)')
    .requiredOption('--session <id>', 'Session id to fold')
    .option('--format <fmt>', 'Output format: summary | json', 'summary')
    .option('--project-root <path>', 'Project root', process.cwd())
    .action((options: ShowOptions) => {
      const fmt = options.format.toLowerCase();
      if (fmt !== 'summary' && fmt !== 'json') {
        process.stderr.write(`error: invalid --format '${options.format}' (summary|json)\n`);
        process.exitCode = 2;
        return;
      }
      const fold = foldRagEvidenceSession(resolve(options.projectRoot), options.session as string);
      process.stdout.write(
        fmt === 'json' ? `${JSON.stringify(fold, null, 2)}\n` : renderSummary(fold),
      );
    });

  command
    .command('record')
    .description('Record one event (script-only; used by the runtime seams, not hand-authored)')
    .argument('<kind>', `Event kind: ${RECORD_KINDS.join(' | ')}`)
    .option('--session <id>', 'Session id (host hint; minted/cached when absent)')
    .option('--adapter <name>', 'Provider adapter', 'claude-code')
    .option('--rag-enabled', 'Mark the master switch as on at event time', false)
    .option('--ordinal <n>', 'Conversation ordinal (resolved from the .open pointer when absent)')
    .option('--open', 'Open a new conversation and record against it', false)
    .option('--json <fields>', 'Kind-specific fields as a JSON object')
    .option('--project-root <path>', 'Project root', process.cwd())
    .action((kind: string, options: RecordOptions) => {
      if (!RECORD_KINDS.includes(kind as RagEvidenceKind)) {
        process.stderr.write(`error: invalid kind '${kind}' (${RECORD_KINDS.join('|')})\n`);
        process.exitCode = 2;
        return;
      }
      const projectRoot = resolve(options.projectRoot);
      const sessionId = resolveSessionId(projectRoot, options.session);
      let fields: RagEvidenceFields = {};
      if (options.json) {
        try {
          fields = JSON.parse(options.json) as RagEvidenceFields;
        } catch {
          process.stderr.write('error: --json is not valid JSON\n');
          process.exitCode = 2;
          return;
        }
      }
      const ctx = {
        sessionId,
        adapter: options.adapter,
        ragEnabled: Boolean(options.ragEnabled),
        ...(options.ordinal ? { ordinal: Number(options.ordinal) } : {}),
      };
      if (options.open) {
        openRagConversation(projectRoot, ctx);
      }
      recordRagEvidence(projectRoot, kind as RagEvidenceKind, fields, ctx);
    });

  return command;
}
