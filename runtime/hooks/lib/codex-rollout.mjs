import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const MAX_DEPTH = 6;

export function codexSessionsDir() {
  const home =
    typeof process.env.CODEX_HOME === 'string' && process.env.CODEX_HOME.trim() !== ''
      ? process.env.CODEX_HOME.trim()
      : join(homedir(), '.codex');
  return join(home, 'sessions');
}

export function collectRolloutFiles(root, depth = 0) {
  if (depth > MAX_DEPTH) return [];
  const found = [];
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      found.push(...collectRolloutFiles(full, depth + 1));
    } else if (
      entry.isFile() &&
      entry.name.startsWith('rollout-') &&
      entry.name.endsWith('.jsonl')
    ) {
      try {
        found.push({ path: full, name: entry.name, mtimeMs: statSync(full).mtimeMs });
      } catch {}
    }
  }
  return found;
}

export function resolveCodexRolloutText(sessionId) {
  try {
    const sessionsDir = codexSessionsDir();
    if (!existsSync(sessionsDir)) return '';
    const rollouts = collectRolloutFiles(sessionsDir);
    if (rollouts.length === 0) return '';
    let chosen;
    if (typeof sessionId === 'string' && sessionId.trim() !== '') {
      chosen = rollouts.find((file) => file.name.includes(sessionId.trim()));
    }
    if (!chosen) {
      chosen = rollouts.reduce((newest, file) => (file.mtimeMs > newest.mtimeMs ? file : newest));
    }
    return readFileSync(chosen.path, 'utf8');
  } catch {
    return '';
  }
}
