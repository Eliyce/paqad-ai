import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';

import { recordDeliveryEvidence } from './delivery-ledger.js';
import type { DetectedDelivery } from './detection.js';

/**
 * Issue #42 — persistence for delivery-convention detection. The detected
 * values live in a side artifact (`.paqad/delivery-detection.json`) so the
 * commented `delivery-policy.yaml` is never rewritten. The loader overlays this
 * file onto the `auto` sections (operational); the dashboard reads its evidence
 * from the session-ledger (buildout F6).
 *
 * `writeDetection` is the single producer call and writes BOTH sinks together so
 * they never drift: the file (operational — the policy loader + the documentation
 * workflow) and a `delivery-evidence` ledger row (the evidence the dashboard +
 * SIEM fold-view read).
 */

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
  // Evidence sink (buildout F6) — also record on the session-ledger so the
  // dashboard + SIEM fold-view see the same detection the file holds.
  recordDeliveryEvidence(projectRoot, detected);
}
