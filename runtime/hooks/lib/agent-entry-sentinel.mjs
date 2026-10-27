import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

import { resolveProjectRoot } from './paqad-disabled.mjs';

export const LOADED_INSTRUCTION_DIRS = Object.freeze(['stack', 'design-system', 'workflows']);

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

export function sentinelDetail(
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
    return { state: 'missing', files: [] };
  }

  const newer = (relativePath) => {
    try {
      return statSync(join(projectRoot, relativePath)).mtimeMs > sentinelMtime;
    } catch {
      return false;
    }
  };

  if (newer(entryFile(env))) {
    rmSync(sentinel, { force: true });
    return { state: 'stale:entry-file', files: [] };
  }
  if (newer('.paqad/framework-path.txt')) {
    rmSync(sentinel, { force: true });
    return { state: 'stale:framework-path', files: [] };
  }
  const loadedDirs = LOADED_INSTRUCTION_DIRS.map((dir) =>
    join(projectRoot, 'docs', 'instructions', dir),
  );
  if (loadedDirs.some((dir) => anyFileNewer(dir, sentinelMtime))) {
    const files = loadedDirs
      .flatMap((dir) => filesNewer(dir, sentinelMtime))
      .map((full) => relative(projectRoot, full).split(sep).join('/'))
      .sort();
    return { state: 'stale:docs-instructions', files };
  }
  return { state: 'fresh', files: [] };
}

export function sentinelState(
  projectRoot = resolveProjectRoot(),
  env = process.env,
  agentId,
  sessionId,
) {
  return sentinelDetail(projectRoot, env, agentId, sessionId).state;
}

function anyFileNewer(dir, mtime, skipDir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (full !== skipDir && anyFileNewer(full, mtime, skipDir)) {
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

export function filesNewer(dir, mtime, skipDir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const found = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (full !== skipDir) {
        found.push(...filesNewer(full, mtime, skipDir));
      }
      continue;
    }
    try {
      if (statSync(full).mtimeMs > mtime) {
        found.push(full);
      }
    } catch {}
  }
  return found;
}

export const CHANGED_FILES_SHOWN = 10;

export function changedFilesLines(files, cap = CHANGED_FILES_SHOWN) {
  const shown = files.slice(0, cap).map((file) => `[paqad]   ${file}`);
  const hidden = files.length - shown.length;
  return hidden > 0 ? [...shown, `[paqad]   and ${hidden} more`] : shown;
}
