import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const DIR = '501-csv-export-01M5AZ6RTF8YZ1MY304KZ2BPJ3';
export const SES = 'ses_cost';

export function at(clock: string): string {
  return `2026-10-19T${clock}:00.000Z`;
}

export function writeStageRows(
  root: string,
  rows: Array<[kind: string, clock: string, stage?: string]>,
): string {
  const dir = join(root, '.paqad/ledger/feature-evidence', DIR);
  mkdirSync(dir, { recursive: true });
  const lines = rows.map(([kind, clock, stage]) =>
    JSON.stringify({
      schema_version: 2,
      doc_type: 'paqad.stage-evidence',
      change: '01M5AZ6RTF8YZ1MY304KZ2BPJ3',
      session_id: SES,
      recorded_at: at(clock),
      content_hash: `fixture-${kind}-${clock}`,
      kind,
      agent: 'orchestrator',
      ...(stage ? { stage } : {}),
    }),
  );
  writeFileSync(join(dir, 'stage-evidence.jsonl'), lines.join('\n') + '\n', 'utf8');
  return dir;
}

export interface Usage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export function assistant(
  id: string,
  clock: string | null,
  usage: Usage,
  options: { model?: string; command?: string } = {},
): string {
  return JSON.stringify({
    type: 'assistant',
    ...(clock === null ? {} : { timestamp: at(clock) }),
    message: {
      id,
      model: options.model ?? 'claude-opus-5-5',
      role: 'assistant',
      content: options.command
        ? [{ type: 'tool_use', name: 'Bash', input: { command: options.command } }]
        : [{ type: 'text', text: 'x' }],
      usage: {
        input_tokens: usage.input ?? 0,
        output_tokens: usage.output ?? 0,
        cache_read_input_tokens: usage.cacheRead ?? 0,
        cache_creation_input_tokens: usage.cacheWrite ?? 0,
      },
    },
  });
}

export function writeTranscript(root: string, name: string, lines: string[]): string {
  const dir = join(root, 'transcripts');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${name}.jsonl`);
  writeFileSync(path, lines.join('\n') + '\n', 'utf8');
  return path;
}

export function total(usage: Usage): number {
  return (
    (usage.input ?? 0) + (usage.output ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0)
  );
}
