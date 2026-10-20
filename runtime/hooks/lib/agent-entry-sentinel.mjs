import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { resolveProjectRoot } from './paqad-disabled.mjs';

export function entryFile(env = process.env) {
  return env.PAQAD_ENTRY_FILE || 'CLAUDE.md';
}

export function sentinelRelative(sessionId) {
  const safe = safeFileKey(sessionId);
  return safe.length === 0 ? '.paqad/.agent-entry-loaded' : `.paqad/.agent-entry-loaded.d/${safe}`;
}

export function sentinelPath(projectRoot, sessionId) {
  return join(projectRoot, ...sentinelRelative(sessionId).split('/'));
}

export function agentEntryMarkerDir(projectRoot) {
  return join(projectRoot, '.paqad', 'session', 'agent-entry');
}

function safeFileKey(id) {
  return typeof id === 'string' ? id.trim().replace(/[^A-Za-z0-9_-]/g, '_') : '';
}

export function agentEntryMarkerPath(projectRoot, agentId) {
  const safe = safeFileKey(agentId);
  if (safe.length === 0) {
    return null;
  }
  return join(agentEntryMarkerDir(projectRoot), safe);
}

export function agentEntryMarkerRelative(agentId) {
  const safe = safeFileKey(agentId);
  return safe.length === 0 ? null : `.paqad/session/agent-entry/${safe}`;
}

export function stampAgentEntryMarker(projectRoot, agentId) {
  const marker = agentEntryMarkerPath(projectRoot, agentId);
  if (!marker) {
    return;
  }
  try {
    mkdirSync(agentEntryMarkerDir(projectRoot), { recursive: true });
    writeFileSync(marker, `${JSON.stringify({ loaded_at: new Date().toISOString(), agentId })}\n`);
  } catch {}
}

export function clearAgentEntryMarkers(projectRoot) {
  try {
    rmSync(agentEntryMarkerDir(projectRoot), { recursive: true, force: true });
  } catch {}
}

export function stampSessionSentinel(projectRoot, sessionId, entry) {
  if (safeFileKey(sessionId).length === 0) {
    return;
  }
  const target = sentinelPath(projectRoot, sessionId);
  try {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(
      target,
      `${JSON.stringify({ loaded_at: new Date().toISOString(), entry_file: entry })}\n`,
    );
  } catch {}
}

export function sentinelState(
  projectRoot = resolveProjectRoot(),
  env = process.env,
  agentId,
  sessionId,
) {
  const sentinel =
    agentEntryMarkerPath(projectRoot, agentId) ?? sentinelPath(projectRoot, sessionId);
  let sentinelMtime;
  try {
    sentinelMtime = statSync(sentinel).mtimeMs;
  } catch {
    return 'missing';
  }

  const newer = (relative) => {
    try {
      return statSync(join(projectRoot, relative)).mtimeMs > sentinelMtime;
    } catch {
      return false;
    }
  };

  if (newer(entryFile(env))) {
    rmSync(sentinel, { force: true });
    return 'stale:entry-file';
  }
  if (newer('.paqad/framework-path.txt')) {
    rmSync(sentinel, { force: true });
    return 'stale:framework-path';
  }
  if (anyFileNewer(join(projectRoot, 'docs', 'instructions'), sentinelMtime)) {
    rmSync(sentinel, { force: true });
    return 'stale:docs-instructions';
  }
  return 'fresh';
}

function anyFileNewer(dir, mtime) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (anyFileNewer(full, mtime)) {
        return true;
      }
    } else {
      try {
        if (statSync(full).mtimeMs > mtime) {
          return true;
        }
      } catch {}
    }
  }
  return false;
}
