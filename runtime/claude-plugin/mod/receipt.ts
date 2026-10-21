import { isCommandName, slash } from './command-name';
import { NO_RECEIPT, subcommandOf } from './commands';
import type { TableLine } from './table';
import type { PaqadHudSnapshot, PaqadTone } from './types';

type Verdict = NonNullable<PaqadHudSnapshot['verdict']>;

const SEAL_TONE: Record<Verdict['kind'], PaqadTone> = {
  pass: 'good',
  fail: 'bad',
  inconclusive: 'warn',
};

export function verdictKey(verdict: Verdict | null | undefined): string | null {
  if (!verdict) return null;
  return [verdict.kind, verdict.word, verdict.at ?? '', verdict.reasons.join('\n')].join('|');
}

export interface VerdictWatch {
  fire: boolean;
  seen: string | null | undefined;
}

export function watchVerdict(seen: string | null | undefined, key: string | null): VerdictWatch {
  if (seen === undefined) return { fire: false, seen: key };
  if (key === null || key === seen) return { fire: false, seen };
  return { fire: true, seen: key };
}

export function verdictToast(verdict: Verdict): string {
  return `paqad sealed the receipt: ${verdict.word}. ${slash('receipt')} shows why.`;
}

export function isReceiptCommand(command: string, args: string): boolean {
  return isCommandName(command) && subcommandOf(args) === 'receipt';
}

function bodyLine(raw: string): TableLine {
  const text = raw.replace(/^>\s?/, '').replace(/\*\*/g, '');
  return [{ text: text === '' ? ' ' : text }];
}

export function receiptCard(text: string, verdict: Verdict | null): TableLine[] | null {
  const body = text.trim();
  if (body === '' || body === NO_RECEIPT) return null;
  const seal: TableLine = verdict
    ? [
        { text: 'Sealed ', dim: true },
        { text: verdict.word, tone: SEAL_TONE[verdict.kind] },
      ]
    : [
        { text: 'Not sealed ', dim: true },
        { text: 'no verdict has landed yet', dim: true },
      ];
  return [[{ text: 'paqad receipt', dim: true }], seal, ...body.split(/\r?\n/).map(bodyLine)];
}
