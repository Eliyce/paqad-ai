import { realpathSync } from 'node:fs';

import { isAbsolute, relative, resolve } from 'pathe';

export class ArtifactOutOfTreeError extends Error {
  constructor(public readonly input: string) {
    super(`artifact must be a path inside the project; got ${input}`);
    this.name = 'ArtifactOutOfTreeError';
  }
}

function realOrLexical(p: string): string {
  try {
    return realpathSync.native(p);
  } catch {
    return p;
  }
}

function isEscape(rel: string): boolean {
  return (
    rel === '' || rel === '..' || rel.startsWith('../') || rel.startsWith('..\\') || isAbsolute(rel)
  );
}

export function normalizeArtifactPath(projectRoot: string, input: string): string {
  const rootResolved = resolve(projectRoot);
  const rootReal = realOrLexical(rootResolved);
  const absInput = isAbsolute(input) ? realOrLexical(input) : resolve(rootReal, input);

  for (const root of new Set([rootReal, rootResolved])) {
    const rel = relative(root, absInput);
    if (!isEscape(rel)) {
      return rel.replace(/\\/g, '/');
    }
  }
  throw new ArtifactOutOfTreeError(input);
}
