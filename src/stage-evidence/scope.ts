// Feature-development scope (issue #310).
//
// The stage gate governs FEATURE DEVELOPMENT — a change that touches product source.
// A documentation-only change (`docs/**`, markdown) or a framework-internal change
// (`.paqad/**`) is not a feature being built, so the planning → specification → … →
// checks stages do not apply. Asking a question, an RCA writeup, a design-test, or a
// pentest that only touches docs must never be forced through the code-development
// stages.
//
// Deliberately keyed on an EXCLUDE list (documentation + framework paths), never an
// allowlist of source directories: an onboarded project can be any stack (a Laravel
// app under `app/*.php`, a Python or Go service, …), so allowlisting `src/`/tests
// would silently UNDER-gate every non-JS codebase. Anything that is not documentation
// or framework-internal is treated as a feature-development change (fail-closed for
// code — the safe direction for an enforcement gate).

import { isAbsolute, relative } from 'pathe';

/** Normalise a possibly-absolute host path to a project-relative posix path. */
function toRelativePosix(targetPath: string, projectRoot?: string): string {
  const rel =
    projectRoot && isAbsolute(targetPath) ? relative(projectRoot, targetPath) : targetPath;
  return rel.replace(/\\/g, '/').replace(/^\.\//, '');
}

/**
 * Framework-internal paths: paqad's own metadata (ledger, decisions, config, the
 * agent-entry sentinel). Never product code, and gating them deadlocks bookkeeping
 * (the sentinel write, the `.config.policy` escape hatch), so the feature-dev gate
 * never applies. A path resolved to outside the project root (`../…`) is also
 * treated as non-feature (it is not part of this repository's source).
 */
export function isFrameworkInternalPath(targetPath: string, projectRoot?: string): boolean {
  const p = toRelativePosix(targetPath, projectRoot);
  return p === '' || p === '.paqad' || p.startsWith('.paqad/') || p.startsWith('../');
}

/**
 * A documentation path: the `docs/` tree (any depth, including the canonical contract
 * under `docs/instructions/**`), a markdown/reStructuredText doc file anywhere, or a
 * top-level project doc (README / CHANGELOG / CONTRIBUTING / LICENSE / NOTICE, any
 * extension). Language-agnostic: it never presumes a source layout.
 */
export function isDocumentationPath(targetPath: string, projectRoot?: string): boolean {
  const p = toRelativePosix(targetPath, projectRoot);
  if (p === 'docs' || p.startsWith('docs/')) return true;
  if (/\.(md|mdx|markdown|mdown|rst|adoc)$/i.test(p)) return true;
  if (/^(readme|changelog|contributing|license|licence|notice|authors)(\.|$)/i.test(p)) return true;
  return false;
}

/**
 * True when an edit to `targetPath` is a feature-development change the stage gate
 * governs. A missing/unknown path is treated as in-scope (fail-closed): the real host
 * always supplies a path, so this only affects a payload-less call, which must not
 * silently skip enforcement.
 */
export function isFeatureDevEdit(targetPath: string | undefined, projectRoot?: string): boolean {
  if (!targetPath) return true; // unknown intent → gate (fail-closed for code)
  if (isFrameworkInternalPath(targetPath, projectRoot)) return false;
  if (isDocumentationPath(targetPath, projectRoot)) return false;
  return true;
}

/**
 * True when a whole change (its changed-file set) is feature development: at least one
 * file is a non-doc, non-framework product change. An empty set is not feature
 * development (nothing to build), so the completion gate does not apply to it.
 */
export function changeIsFeatureDev(files: readonly string[], projectRoot?: string): boolean {
  return files.some((file) => isFeatureDevEdit(file, projectRoot));
}
