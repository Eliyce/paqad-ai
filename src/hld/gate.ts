import type { Lane } from '@/core/types/routing.js';

import { designSignOffWaits, loadDesignSignOff } from './applies.js';
import { GATE_NO_DESIGN_LINE, gateBlockLine } from './copy.js';
import { readHld } from './store.js';

const OPEN_STATES = new Set(['approved', 'skipped', 'not_posted']);

export function designSignOffBlock(
  projectRoot: string,
  dirName: string,
  lane: Lane,
): string | null {
  const config = loadDesignSignOff(projectRoot);
  if (!designSignOffWaits(config, lane)) return null;
  const record = readHld(projectRoot, dirName);
  if (record === null) return GATE_NO_DESIGN_LINE;
  if (OPEN_STATES.has(record.state)) return null;
  return gateBlockLine(record.ref, config.allow_skip_with_reason);
}
