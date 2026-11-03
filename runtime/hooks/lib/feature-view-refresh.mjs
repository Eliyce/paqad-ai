import { spawn as nodeSpawn } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const FEATURE_VIEW_PATH = 'docs/instructions/workflows/feature-development.yaml';
export const FEATURE_VIEW_HASH_PATH = '.paqad/state/feature-development-view.sha256';

const SOURCES = [
  '.paqad/configs/feature-development/workflow.yaml',
  '.paqad/configs/feature-development/checks.yaml',
  '.paqad/framework-version.txt',
  '.paqad/project-profile.yaml',
];

function mtime(path) {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

function isCodingProject(projectRoot) {
  try {
    return readFileSync(join(projectRoot, '.paqad', 'project-profile.yaml'), 'utf8').includes(
      'coding',
    );
  } catch {
    return false;
  }
}

export function viewRefreshDue(projectRoot) {
  if (!isCodingProject(projectRoot)) return false;
  const stamp = mtime(join(projectRoot, FEATURE_VIEW_HASH_PATH));
  if (stamp === null) return true;
  const view = mtime(join(projectRoot, FEATURE_VIEW_PATH));
  if (view === null || view > stamp) return true;
  return SOURCES.some((rel) => {
    const changed = mtime(join(projectRoot, rel));
    return changed !== null && changed > stamp;
  });
}

export function maybeSpawnViewRefresh({
  projectRoot,
  cliPath,
  env = process.env,
  spawn = nodeSpawn,
}) {
  try {
    if (!cliPath || !viewRefreshDue(projectRoot)) return false;
    const child = spawn(
      process.execPath,
      [cliPath, 'config', 'view', '--project-root', projectRoot],
      { detached: true, stdio: 'ignore', windowsHide: true, env },
    );
    child.on?.('error', () => {});
    child.unref?.();
    return true;
  } catch {
    return false;
  }
}
