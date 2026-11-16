import { existsSync } from 'node:fs';
import { URL, fileURLToPath, pathToFileURL } from 'node:url';

const SRC = new URL('../../../../../src/', import.meta.url);

export async function resolve(specifier, context, nextResolve) {
  let target = specifier;
  if (target.startsWith('@/')) target = new URL(target.slice(2), SRC).href;
  if (target.endsWith('.js') && (target.startsWith('file:') || target.startsWith('.'))) {
    const asTs = new URL(target.replace(/\.js$/u, '.ts'), context.parentURL ?? import.meta.url);
    if (existsSync(fileURLToPath(asTs))) return nextResolve(asTs.href, context);
  }
  return nextResolve(target, context);
}

export const loaderUrl = pathToFileURL(fileURLToPath(import.meta.url)).href;
