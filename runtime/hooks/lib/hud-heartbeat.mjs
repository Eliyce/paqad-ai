import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { logHookFailure } from './hook-log.mjs';

export const HEARTBEAT_WINDOW_MS = 120_000;

export const QUIET_NARRATION_LINE =
  '[paqad] The paqad HUD is live in this session and shows each stage as it runs, so skip the per-stage ▸ paqad lines. Keep the route line and the receipt.';

const HUD_DIR = join('.paqad', 'session', 'hud');

function safeSessionId(sessionId) {
  return sessionId.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '_') || 'unknown';
}

export function heartbeatPath(projectRoot, sessionId) {
  return join(projectRoot, HUD_DIR, `${safeSessionId(sessionId)}.live`);
}

export function heartbeatIsFresh(projectRoot, sessionId, now = Date.now()) {
  if (typeof sessionId !== 'string' || sessionId.trim() === '') return false;
  let modified;
  try {
    modified = statSync(heartbeatPath(projectRoot, sessionId)).mtimeMs;
  } catch (error) {
    if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') throw error;
    return false;
  }
  const age = now - modified;
  return age >= 0 && age <= HEARTBEAT_WINDOW_MS;
}

function hudSnapshotPath(projectRoot, sessionId) {
  return join(projectRoot, HUD_DIR, `${safeSessionId(sessionId)}.json`);
}

export function snapshotQualified(projectRoot, sessionId) {
  let raw;
  try {
    raw = readFileSync(hudSnapshotPath(projectRoot, sessionId), 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') throw error;
    return false;
  }
  return JSON.parse(raw)?.scope?.qualified === true;
}

export function quietNarration(projectRoot, sessionId, adapter, now = Date.now()) {
  if (adapter !== undefined && adapter !== 'claude-code') return '';
  try {
    const shown =
      heartbeatIsFresh(projectRoot, sessionId, now) && snapshotQualified(projectRoot, sessionId);
    return shown ? `${QUIET_NARRATION_LINE}\n` : '';
  } catch (error) {
    logHookFailure(
      projectRoot,
      'agent-entry-prompt-gate',
      error,
      'reading the HUD heartbeat and snapshot',
    );
    return '';
  }
}
