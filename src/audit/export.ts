// Issue #121 — the export orchestrator: aggregate → filter(since) → redact? →
// format. Pure (string in, string out); the CLI owns stdout/file I/O.

import { aggregateSiemEvents } from './aggregate.js';
import { toCef } from './formats/cef.js';
import { toEcs } from './formats/ecs.js';
import { toOcsf } from './formats/ocsf.js';
import { redactEvent } from './redact.js';
import type { ExportOptions, ExportResult, SiemEvent, SiemFormat } from './types.js';

/** One event → one serialized line in the target format. */
function formatLine(event: SiemEvent, format: SiemFormat, productVersion: string): string {
  switch (format) {
    case 'ocsf':
      return toOcsf(event, productVersion);
    case 'ecs':
      return toEcs(event, productVersion);
    case 'cef':
      return toCef(event, productVersion);
    case 'jsonl':
      return JSON.stringify(event);
  }
}

/** Keep events at or after the `since` cutoff. Events whose `ts` is unparseable
 *  are dropped when a cutoff is set (they cannot be proven to be in range). */
function filterSince(events: SiemEvent[], since: string): SiemEvent[] {
  const cutoff = Date.parse(since);
  return events.filter((event) => {
    const t = Date.parse(event.ts);
    return !Number.isNaN(t) && t >= cutoff;
  });
}

/**
 * Read the ledger + receipt chain and project them into the target SIEM format.
 * `output` is newline-separated with no trailing newline; the CLI adds one.
 */
export function exportAuditEvents(projectRoot: string, options: ExportOptions): ExportResult {
  let events = aggregateSiemEvents(projectRoot);

  if (options.since !== undefined) {
    events = filterSince(events, options.since);
  }
  if (options.redact === true) {
    events = events.map(redactEvent);
  }

  const lines = events.map((event) => formatLine(event, options.format, options.productVersion));
  return { format: options.format, count: events.length, output: lines.join('\n') };
}
