import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { appendHookLog, logHookFailure } from './hook-log.mjs';

export const HEARTBEAT_WINDOW_MS = 120_000;

export const SNAPSHOT_FRESH_MS = 15 * 60_000;

export const CLOUD_HUD_LINE =
  "The paqad HUD cannot draw in a cloud session: Claude Code shows no plugin view there. paqad's checks still run.";

export const HUD_NOT_ATTACHED_NOTE =
  'HUD not attached: this Claude Code session has a fresh paqad snapshot, but the paqad HUD has not drawn it.';

export const HUD_NOT_ATTACHED_FIX =
  'Install or turn on the paqad plugin (`claude plugin install paqad@eliyce --scope user`), then type /reload-plugins.';

export const PLUGIN_RELOAD_LINE =
  'paqad installed its Claude Code plugin: type /reload-plugins to see the HUD now, or it shows next session.';

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

export function snapshotPath(projectRoot, sessionId) {
  return hudSnapshotPath(projectRoot, sessionId);
}

export function unattachedPath(projectRoot, sessionId) {
  return join(projectRoot, HUD_DIR, `${safeSessionId(sessionId)}.unattached`);
}

function notedPath(projectRoot, sessionId, what) {
  return join(projectRoot, HUD_DIR, `${safeSessionId(sessionId)}.${what}-noted`);
}

export function isCloudSession(env = process.env) {
  return (
    String(env.CLAUDE_CODE_REMOTE ?? '')
      .trim()
      .toLowerCase() === 'true'
  );
}

function isHeadless(env) {
  return (
    (typeof env.CI === 'string' && env.CI !== '') ||
    (typeof env.PAQAD_HEADLESS === 'string' && env.PAQAD_HEADLESS !== '') ||
    env.CLAUDE_CODE_ENTRYPOINT === 'sdk-cli'
  );
}

function mtimeOf(path) {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

export function snapshotIsFresh(projectRoot, sessionId, now = Date.now()) {
  if (typeof sessionId !== 'string' || sessionId.trim() === '') return false;
  const modified = mtimeOf(hudSnapshotPath(projectRoot, sessionId));
  if (modified === null) return false;
  const age = now - modified;
  return age >= 0 && age <= SNAPSHOT_FRESH_MS;
}

function noteOnce(projectRoot, sessionId, what, now) {
  const path = notedPath(projectRoot, sessionId, what);
  if (existsSync(path)) return false;
  mkdirSync(join(projectRoot, HUD_DIR), { recursive: true });
  writeFileSync(path, `${new Date(now).toISOString()}\n`, 'utf8');
  return true;
}

export function cloudHudLine(projectRoot, sessionId, env = process.env, now = Date.now()) {
  if (!isCloudSession(env) || typeof sessionId !== 'string' || sessionId.trim() === '') return '';
  try {
    return noteOnce(projectRoot, sessionId, 'cloud', now) ? `[paqad] ${CLOUD_HUD_LINE}\n` : '';
  } catch (error) {
    logHookFailure(projectRoot, 'agent-entry-prompt-gate', error, 'noting the cloud HUD line');
    return '';
  }
}

export function recordHudAttachment(projectRoot, sessionId, options = {}) {
  const env = options.env ?? process.env;
  const now = options.now ?? Date.now();
  const adapter = options.adapter;
  if (adapter !== undefined && adapter !== 'claude-code') return '';
  if (typeof sessionId !== 'string' || sessionId.trim() === '') return '';
  if (isCloudSession(env) || isHeadless(env)) return '';
  try {
    const record = unattachedPath(projectRoot, sessionId);
    if (heartbeatIsFresh(projectRoot, sessionId, now)) {
      if (existsSync(record)) rmSync(record, { force: true });
      return '';
    }
    if (!snapshotIsFresh(projectRoot, sessionId, now) || existsSync(record)) return '';
    const at = new Date(now).toISOString();
    mkdirSync(join(projectRoot, HUD_DIR), { recursive: true });
    writeFileSync(
      record,
      `${JSON.stringify({ session_id: sessionId, at, note: HUD_NOT_ATTACHED_NOTE, fix: HUD_NOT_ATTACHED_FIX })}\n`,
      'utf8',
    );
    appendHookLog(projectRoot, `hud: ${HUD_NOT_ATTACHED_NOTE} (session ${sessionId})`);
    return `[paqad] ${HUD_NOT_ATTACHED_NOTE} ${HUD_NOT_ATTACHED_FIX}\n`;
  } catch (error) {
    logHookFailure(projectRoot, 'agent-entry-prompt-gate', error, 'recording the HUD attachment');
    return '';
  }
}

export function pluginMigrateMarkPath(projectRoot, sessionId) {
  return join(projectRoot, '.paqad', 'session', 'plugin-migrate.d', safeSessionId(sessionId));
}

function migrationInstalledAt(home) {
  try {
    const record = JSON.parse(
      readFileSync(join(home, '.paqad-ai', 'plugin-migration.json'), 'utf8'),
    );
    if (record?.state !== 'installed' && record?.state !== 'done') return null;
    const at = Date.parse(String(record.installed_at ?? ''));
    return Number.isFinite(at) ? at : null;
  } catch {
    return null;
  }
}

export function pluginReloadLine(projectRoot, sessionId, options = {}) {
  const env = options.env ?? process.env;
  const now = options.now ?? Date.now();
  const home = options.home ?? homedir();
  if (typeof sessionId !== 'string' || sessionId.trim() === '' || isCloudSession(env)) return '';
  try {
    const started = mtimeOf(pluginMigrateMarkPath(projectRoot, sessionId));
    if (started === null || existsSync(heartbeatPath(projectRoot, sessionId))) return '';
    const installedAt = migrationInstalledAt(home);
    if (installedAt === null || installedAt < started - 1000) return '';
    return noteOnce(projectRoot, sessionId, 'reload', now) ? `[paqad] ${PLUGIN_RELOAD_LINE}\n` : '';
  } catch (error) {
    logHookFailure(projectRoot, 'agent-entry-prompt-gate', error, 'noting the plugin reload line');
    return '';
  }
}
