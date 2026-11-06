import type { Lane } from '@/core/types/routing.js';

import { designSignOffApplies, loadDesignSignOff } from './applies.js';
import {
  prSignedOffLine,
  prSkippedLine,
  RECEIPT_NOT_POSTED_LINE,
  RECEIPT_NOT_WRITTEN_LINE,
  RECEIPT_OFF_LINE,
  RECEIPT_POSTED_LINE,
  receiptSignedOffLine,
  receiptSkippedLine,
} from './copy.js';
import { readHld } from './store.js';

export function designSignOffPrLine(projectRoot: string, dirName: string | null): string {
  if (dirName === null) return '';
  const record = readHld(projectRoot, dirName);
  if (record?.state === 'approved' && record.approved_at && record.approval_link) {
    return prSignedOffLine(record.ref, record.approved_at, record.approval_link);
  }
  if (record?.state === 'skipped' && record.skip_reason) return prSkippedLine(record.skip_reason);
  return '';
}

export function designSignOffReceiptLine(
  projectRoot: string,
  dirName: string | null,
  lane: Lane | null,
): string {
  if (dirName === null || !designSignOffApplies(loadDesignSignOff(projectRoot), lane)) {
    return RECEIPT_OFF_LINE;
  }
  const record = readHld(projectRoot, dirName);
  if (record === null) return RECEIPT_NOT_WRITTEN_LINE;
  if (record.state === 'approved') return receiptSignedOffLine(record.approval_link ?? '');
  if (record.state === 'skipped') return receiptSkippedLine(record.skip_reason ?? '');
  if (record.state === 'not_posted') return RECEIPT_NOT_POSTED_LINE;
  return RECEIPT_POSTED_LINE;
}
