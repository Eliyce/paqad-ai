import { describe, expect, it } from 'vitest';

import { NO_RECEIPT } from '../../../../runtime/claude-plugin/mod/commands.ts';
import {
  isReceiptCommand,
  receiptCard,
  verdictKey,
  verdictToast,
  watchVerdict,
} from '../../../../runtime/claude-plugin/mod/receipt.ts';

const PASS = { word: 'Safe to merge', kind: 'pass' as const, reasons: [], at: '2026-10-18T08:59' };
const FAIL = { word: 'Needs your attention', kind: 'fail' as const, reasons: ['review missing'] };

describe('the verdict watch', () => {
  it('seeds on the first read without firing', () => {
    expect(watchVerdict(undefined, verdictKey(PASS))).toEqual({
      fire: false,
      seen: verdictKey(PASS),
    });
    expect(watchVerdict(undefined, null)).toEqual({ fire: false, seen: null });
  });

  it('fires once when a new verdict lands, and never again for the same one', () => {
    const landed = watchVerdict(null, verdictKey(PASS));
    expect(landed).toEqual({ fire: true, seen: verdictKey(PASS) });
    expect(watchVerdict(landed.seen, verdictKey(PASS))).toEqual({ fire: false, seen: landed.seen });
    expect(watchVerdict(landed.seen, null)).toEqual({ fire: false, seen: landed.seen });
    expect(watchVerdict(landed.seen, verdictKey(FAIL)).fire).toBe(true);
  });

  it('keys a verdict on its kind, word, time and reasons', () => {
    expect(verdictKey(null)).toBeNull();
    expect(verdictKey(PASS)).not.toBe(verdictKey({ ...PASS, at: '2026-10-18T09:30' }));
    expect(verdictKey(FAIL)).toBe('fail|Needs your attention||review missing');
  });

  it('toasts the verdict in words', () => {
    expect(verdictToast(PASS)).toBe(
      'paqad sealed the receipt: Safe to merge. /paqad receipt shows why.',
    );
  });
});

describe('the receipt card', () => {
  it('answers /paqad receipt only', () => {
    expect(isReceiptCommand('paqad', 'receipt')).toBe(true);
    expect(isReceiptCommand('paqad', '  Receipt now')).toBe(true);
    expect(isReceiptCommand('paqad', 'status')).toBe(false);
    expect(isReceiptCommand('cost', 'receipt')).toBe(false);
  });

  it('seals with the verdict in words and its colour, then the receipt body', () => {
    const card = receiptCard('**▸ paqad** · Safe to merge\n> 🟢 planning: done\n', PASS)!;
    expect(card.map((line) => line.map((segment) => segment.text).join(''))).toEqual([
      'paqad receipt',
      'Sealed Safe to merge',
      '▸ paqad · Safe to merge',
      '🟢 planning: done',
    ]);
    expect(card[1]![1]).toEqual({ text: 'Safe to merge', tone: 'good' });
    expect(receiptCard('x', FAIL)![1]![1]).toEqual({ text: 'Needs your attention', tone: 'bad' });
    expect(
      receiptCard('x', { word: 'Inconclusive', kind: 'inconclusive', reasons: [] })![1]![1],
    ).toEqual({ text: 'Inconclusive', tone: 'warn' });
  });

  it('says it is not sealed before a verdict lands, and draws nothing with no receipt', () => {
    const card = receiptCard('a\n\nb', null)!;
    expect(card[1]!.map((segment) => segment.text).join('')).toBe(
      'Not sealed no verdict has landed yet',
    );
    expect(card[3]).toEqual([{ text: ' ' }]);
    expect(receiptCard(NO_RECEIPT, PASS)).toBeNull();
    expect(receiptCard('  ', PASS)).toBeNull();
  });
});
