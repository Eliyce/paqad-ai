export interface ChainCheck {
  rows: number;
  torn_tail: boolean;
  gaps: string[];
  breaks: number[];
}

const CHAINED_VERSION = 3;
const RECORD_REPAIR = 'record-repair';

interface ChainEntry {
  hash: string | null;
  gap: boolean;
}

function matchesAcrossGaps(entries: readonly ChainEntry[], prevHash: unknown): boolean {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]!;
    if (entry.hash === prevHash) return true;
    if (!entry.gap) return false;
  }
  return entries.length === 0 && prevHash === null;
}

function parseLine(line: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(line) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function repairedRows(lines: readonly string[]): Map<number, { hash: string; reason: string }> {
  const repaired = new Map<number, { hash: string; reason: string }>();
  for (const line of lines) {
    if (line.trim() === '' || !line.includes(RECORD_REPAIR)) continue;
    const row = parseLine(line);
    if (row?.kind !== RECORD_REPAIR) continue;
    if (typeof row.repairs_row !== 'number' || typeof row.repairs_hash !== 'string') continue;
    repaired.set(row.repairs_row, {
      hash: row.repairs_hash,
      reason: typeof row.reason === 'string' ? row.reason : 'no reason given',
    });
  }
  return repaired;
}

export function checkStageChain(raw: string): ChainCheck {
  const lines = raw.split('\n');
  const repaired = repairedRows(lines);
  const check: ChainCheck = { rows: 0, torn_tail: false, gaps: [], breaks: [] };
  const entries: ChainEntry[] = [];
  let seenChained = false;
  lines.forEach((line, index) => {
    if (line.trim() === '') return;
    const number = index + 1;
    const row = parseLine(line);
    if (row === null) {
      check.gaps.push(`row ${number} is a torn line`);
      if (index >= lines.length - 2) check.torn_tail = true;
      return;
    }
    check.rows += 1;
    const hash = typeof row.content_hash === 'string' ? row.content_hash : null;
    if (row.schema_version !== CHAINED_VERSION) {
      if (seenChained) check.gaps.push(`row ${number} was written by an older copy of paqad`);
      entries.push({ hash, gap: seenChained });
      return;
    }
    seenChained = true;
    if (typeof row.chain_note === 'string') {
      check.gaps.push(`row ${number} declares a gap: ${row.chain_note}`);
      entries.push({ hash, gap: true });
      return;
    }
    if (!matchesAcrossGaps(entries, row.prev_hash)) {
      const repair = repaired.get(number);
      if (repair !== undefined && repair.hash === hash) {
        check.gaps.push(`row ${number} broke the chain and was repaired: ${repair.reason}`);
      } else {
        check.breaks.push(number);
      }
    }
    entries.push({ hash, gap: false });
  });
  return check;
}

export function firstChainBreakLine(check: ChainCheck): string | null {
  return check.breaks.length === 0 ? null : `chain broken at row ${check.breaks[0]}`;
}
