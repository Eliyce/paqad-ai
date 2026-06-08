// Changed-file scoping for mutation runs. Issue #105.
//
// The brief insists mutation stays quick — usually by mutating only the changed
// code — and tool-agnostic / multi-language. We reuse the pipeline's
// test/doc classifiers (`isTestFile`/`isDocumentationFile` from change-evidence)
// to drop tests and docs, then keep files with a *mutable source extension*
// across the mainstream languages the adapter targets. We deliberately do not
// reuse `isCodeFile`, whose prefix/extension rules are JS/TS-centric and would
// drop e.g. a Python or Rust source file outside `src/`.

import { isDocumentationFile, isTestFile } from '@/pipeline/change-evidence.js';

// Source extensions a mutation tool can plant into, across the mainstream
// languages the adapter targets. Config/markup/lockfiles are intentionally
// absent: mutating them is not a behaviour signal.
const MUTABLE_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.cs',
  '.java',
  '.kt',
  '.py',
  '.php',
  '.rb',
  '.rs',
  '.go',
];

// Files that satisfy `isCodeFile` but are not behaviour-bearing source we want
// to mutate (manifests, tsconfig, shell scripts).
const EXCLUDED_BASENAMES = ['package.json', 'tsconfig.json'];

function hasMutableExtension(filePath: string): boolean {
  return MUTABLE_EXTENSIONS.some((extension) => filePath.endsWith(extension));
}

/**
 * Narrow a list of changed files to the mutable source files a mutation tool
 * should plant into. Deterministic (sorted, de-duped) so runs are reproducible.
 */
export function scopeMutationTargets(changedFiles: string[]): string[] {
  const scoped = new Set<string>();
  for (const raw of changedFiles) {
    const filePath = raw.replace(/\\/g, '/').trim();
    if (filePath.length === 0) {
      continue;
    }
    if (isTestFile(filePath) || isDocumentationFile(filePath)) {
      continue;
    }
    if (EXCLUDED_BASENAMES.includes(filePath.split('/').at(-1) ?? '')) {
      continue;
    }
    if (!hasMutableExtension(filePath)) {
      continue;
    }
    scoped.add(filePath);
  }
  return [...scoped].sort();
}
