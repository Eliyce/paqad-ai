// Issue #121 — ArcSight Common Event Format (CEF) projection.
//
// CEF is single-line and syslog-ready, still demanded by ArcSight/QRadar SOCs.
// A paqad event is nested; CEF is flat, so we force-fit into the custom-string
// slots (cs1..cs6) and standard keys (rt, outcome, msg, fileHash, suser). One
// line per event, pipe to `logger`/rsyslog. Escaping follows the CEF spec:
// header fields escape `\` and `|`; extension values escape `\`, `=`, and
// newlines.

import { cefSeverity, epochMs } from '../severity.js';
import type { SiemEvent } from '../types.js';

const CEF_VERSION = 'CEF:0';
const VENDOR = 'Paqad';
const PRODUCT = 'paqad-ai';

/** Escape a CEF header field: backslash and pipe. */
export function escapeCefHeader(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
}

/** Escape a CEF extension value: backslash, equals, and newlines. */
export function escapeCefExtension(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/=/g, '\\=').replace(/\r?\n/g, ' ');
}

function pushPair(parts: string[], key: string, value: string | undefined): void {
  if (value !== undefined && value !== '') {
    parts.push(`${key}=${escapeCefExtension(value)}`);
  }
}

/** Render one event as a single CEF line. */
export function toCef(event: SiemEvent, productVersion: string): string {
  const name = `${event.kind} ${event.engine ?? event.code} ${event.verdict}`.trim();
  const header = [
    CEF_VERSION,
    escapeCefHeader(VENDOR),
    escapeCefHeader(PRODUCT),
    escapeCefHeader(productVersion),
    escapeCefHeader(event.code),
    escapeCefHeader(name),
    String(cefSeverity(event.verdict)),
  ].join('|');

  const ext: string[] = [];
  pushPair(ext, 'rt', String(epochMs(event.ts)));
  pushPair(ext, 'outcome', event.verdict);
  pushPair(ext, 'cs1Label', 'subjectDigest');
  pushPair(ext, 'cs1', event.subject_digest);
  pushPair(ext, 'cs2Label', 'strengthClass');
  pushPair(ext, 'cs2', event.strength_class);
  pushPair(ext, 'cs3Label', 'contentHash');
  pushPair(ext, 'cs3', event.content_hash);
  pushPair(ext, 'cs4Label', 'engine');
  pushPair(ext, 'cs4', event.engine);
  pushPair(ext, 'cs5Label', 'signingMode');
  pushPair(ext, 'cs5', event.signing_mode);
  pushPair(ext, 'cs6Label', 'sealed');
  pushPair(ext, 'cs6', event.sealed === undefined ? undefined : String(event.sealed));

  const subjects = event.subjects ?? [];
  if (subjects.length > 0) {
    pushPair(ext, 'fileHash', subjects[0].sha256);
    pushPair(ext, 'fname', subjects[0].name);
    if (subjects.length > 1) {
      pushPair(ext, 'cn1Label', 'changedFiles');
      pushPair(ext, 'cn1', String(subjects.length));
    }
  }

  // #249 session-ledger fold — carry the doc type as the producing service and the
  // session id as the correlation id, both standard CEF keys (only set when present).
  pushPair(ext, 'sourceServiceName', event.doc_type);
  pushPair(ext, 'externalId', event.session_id);

  const human = event.authorship?.accepting_human;
  pushPair(ext, 'suser', human?.email ?? human?.name);
  pushPair(ext, 'msg', event.detail);

  return `${header}|${ext.join(' ')}`;
}
