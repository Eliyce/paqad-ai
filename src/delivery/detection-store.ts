import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';

import { recordDeliveryEvidence } from './delivery-ledger.js';
import type { DetectedDelivery } from './detection.js';

export function detectionPath(projectRoot: string): string {
  return join(projectRoot, PATHS.DELIVERY_DETECTION);
}

export function readDetection(projectRoot: string): DetectedDelivery | null {
  const path = detectionPath(projectRoot);
  if (!existsSync(path)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as DetectedDelivery;
  } catch {
    return null;
  }
}

export function writeDetection(projectRoot: string, detected: DetectedDelivery): void {
  const path = detectionPath(projectRoot);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(detected, null, 2)}\n`, 'utf8');
  recordDeliveryEvidence(projectRoot, detected);
}
