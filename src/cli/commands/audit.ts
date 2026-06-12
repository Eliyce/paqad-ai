import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { Command } from 'commander';

import { exportAuditEvents, SIEM_FORMATS, type SiemFormat } from '@/audit/index.js';
import { VERSION } from '@/index.js';

interface AuditExportOptions {
  format: string;
  since?: string;
  out?: string;
  redact: boolean;
  projectRoot: string;
}

function isSiemFormat(value: string): value is SiemFormat {
  return (SIEM_FORMATS as readonly string[]).includes(value);
}

/**
 * `paqad-ai audit export` — project the #118 evidence ledger + tamper-evident
 * receipt chain into a standard SIEM schema (OCSF / ECS / CEF / JSONL) and write
 * it to a file or stdout. Read-only and local-first: it transforms the on-disk
 * ledger and hands the result to the customer's own collector (Splunk
 * forwarder, rsyslog, Datadog agent, Filebeat). There is no paqad-hosted
 * endpoint — their backend, our data.
 */
export function createAuditCommand(): Command {
  const command = new Command('audit').description(
    'Export the evidence ledger to your own SIEM (read-only, local-first)',
  );

  command
    .command('export')
    .description(
      'Project the evidence ledger + receipts into OCSF / ECS / CEF / JSONL for your own SIEM',
    )
    .option('--format <fmt>', 'Output schema: ocsf | ecs | cef | jsonl', 'ocsf')
    .option('--since <iso>', 'Only export events at or after this ISO-8601 timestamp')
    .option('--out <file>', 'Write to a file instead of stdout (for your collector to ship)')
    .option('--redact', 'Redact free-text detail and human identities', false)
    .option('--project-root <path>', 'Project root', process.cwd())
    .action((options: AuditExportOptions) => {
      const format = options.format.toLowerCase();
      if (!isSiemFormat(format)) {
        process.stderr.write(
          `error: invalid --format value '${options.format}' (expected ${SIEM_FORMATS.join(' | ')})\n`,
        );
        process.exitCode = 2;
        return;
      }

      if (options.since !== undefined && Number.isNaN(Date.parse(options.since))) {
        process.stderr.write(
          `error: invalid --since value '${options.since}' (expected an ISO-8601 timestamp)\n`,
        );
        process.exitCode = 2;
        return;
      }

      const result = exportAuditEvents(resolve(options.projectRoot), {
        format,
        since: options.since,
        redact: options.redact,
        productVersion: VERSION,
      });

      // No trailing newline when empty so an empty export is a truly empty file.
      const payload = result.count > 0 ? `${result.output}\n` : '';

      if (options.out !== undefined) {
        const target = resolve(options.out);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, payload, 'utf8');
        process.stderr.write(
          `audit export: wrote ${result.count} ${format} event(s) to ${target}\n`,
        );
      } else {
        process.stdout.write(payload);
      }

      process.exitCode = 0;
    });

  return command;
}
