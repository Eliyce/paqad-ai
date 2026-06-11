import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';

import type { DetectedDelivery } from './detection.js';

/**
 * Issue #42 — persistence for delivery-convention detection. The detected
 * values live in a side artifact (`.paqad/delivery-detection.json`) so the
 * commented `delivery-policy.yaml` is never rewritten. The loader overlays this
 * onto the `auto` sections; the dashboard / `explain` read evidence from it.
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
}
