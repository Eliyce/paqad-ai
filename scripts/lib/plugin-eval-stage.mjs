import { cpSync, existsSync, mkdirSync, readdirSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const STAGED_ENTRIES = [
  '.claude-plugin',
  'assets',
  'dist',
  'runtime',
  'package.json',
  'evals',
];

export class StagePluginEvalError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StagePluginEvalError';
  }
}

export function stagePluginEval(repoRoot, target) {
  const root = resolve(repoRoot);
  const dest = resolve(target);
  if (!existsSync(join(root, 'dist'))) {
    throw new StagePluginEvalError(
      `dist/ is missing in ${root}: run pnpm run build:server before staging the plugin eval`,
    );
  }
  if (existsSync(dest) && readdirSync(dest).length > 0) {
    throw new StagePluginEvalError(`${dest} is not empty: stage into a new or empty directory`);
  }
  for (const entry of STAGED_ENTRIES) {
    if (!existsSync(join(root, entry))) {
      throw new StagePluginEvalError(`${entry} is missing in ${root}`);
    }
  }
  mkdirSync(dest, { recursive: true });
  for (const entry of STAGED_ENTRIES) {
    cpSync(join(root, entry), join(dest, entry), {
      recursive: true,
      filter: (source) => !/[\\/]evals[\\/](?:.+[\\/])?results(?:[\\/]|$)/.test(source),
    });
  }
  symlinkSync(join(root, 'node_modules'), join(dest, 'node_modules'), 'dir');
  return dest;
}
