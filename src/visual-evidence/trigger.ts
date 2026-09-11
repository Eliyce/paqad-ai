// Frontend trigger (issue #551, Part B).
//
// Decides whether a feature-development change is "frontend-triggering" — i.e. at least one
// changed file matches at least one `visual_evidence.frontend_globs` pattern of an active
// stack pack. Deterministic and model-free. When it is not, everything downstream is a
// `skipped` outcome with reason `not-frontend`.

import { getPacksForFrameworks } from '@/packs/project-packs.js';
import { loadChangeEvidence } from '@/pipeline/change-evidence.js';
import { readProjectProfile } from '@/core/project-profile.js';
import { getPrimaryStack } from '@/core/stack-profile.js';

/** The outcome of evaluating the frontend trigger for a change. */
export interface FrontendTrigger {
  /** True when >= 1 changed file matches >= 1 active pack's frontend_globs. */
  triggered: boolean;
  /** The changed files that matched (posix form), sorted, deduped. */
  matched_files: string[];
  /** The globs that matched at least one file (posix form). */
  matched_globs: string[];
  /** The active packs that contributed a matched glob (pack names). */
  packs: string[];
  /** All changed files considered (posix form). */
  changed_files: string[];
  /** How the changed files were sourced; `none` means the change could not be determined. */
  source: 'session-artifact' | 'git-status' | 'none';
}

/**
 * Translate a glob to an anchored RegExp. Supports `**` (any path span, slashes included),
 * `*` (a single path segment span), `?` (one non-slash char), brace groups `{a,b,c}` (one
 * level, comma = alternation), and literal `.`. Paths are compared in posix form.
 */
export function frontendGlobToRegExp(glob: string): RegExp {
  let out = '';
  let braceDepth = 0;
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i]!;
    const next = glob[i + 1];
    if (ch === '*' && next === '*') {
      if (glob[i + 2] === '/') {
        // `**/` matches zero or more path segments (with their trailing slash).
        out += '(?:.*/)?';
        i += 2;
      } else {
        // A trailing/bare `**` matches any span including slashes.
        out += '.*';
        i += 1;
      }
      continue;
    }
    switch (ch) {
      case '*':
        out += '[^/]*';
        break;
      case '?':
        out += '[^/]';
        break;
      case '{':
        out += '(?:';
        braceDepth += 1;
        break;
      case '}':
        if (braceDepth > 0) {
          out += ')';
          braceDepth -= 1;
        } else {
          out += '\\}';
        }
        break;
      case ',':
        out += braceDepth > 0 ? '|' : '\\,';
        break;
      // Regex metacharacters that must be escaped to match literally.
      case '.':
      case '+':
      case '^':
      case '$':
      case '(':
      case ')':
      case '[':
      case ']':
      case '|':
      case '\\':
        out += `\\${ch}`;
        break;
      default:
        out += ch;
    }
  }
  return new RegExp(`^${out}$`);
}

/** True when the posix-form file path matches the glob. */
export function matchesFrontendGlob(file: string, glob: string): boolean {
  return frontendGlobToRegExp(glob).test(file);
}

function toPosix(file: string): string {
  return file.replace(/\\/g, '/');
}

/** Resolve the active stack frameworks for a project (declared frameworks + primary stack). */
function activeFrameworks(projectRoot: string): string[] {
  const profile = readProjectProfile(projectRoot);
  if (!profile) return [];
  const frameworks = profile.stack_profile?.frameworks ?? [];
  const primary = getPrimaryStack({ stack_profile: profile.stack_profile });
  return [...new Set([...frameworks, primary].filter((name): name is string => Boolean(name)))];
}

/** The frontend_globs of every active pack, flattened (posix patterns). */
export function activeFrontendGlobs(projectRoot: string): Array<{ pack: string; glob: string }> {
  const frameworks = activeFrameworks(projectRoot);
  const out: Array<{ pack: string; glob: string }> = [];
  for (const pack of getPacksForFrameworks(frameworks, projectRoot)) {
    for (const glob of pack.manifest.visual_evidence?.frontend_globs ?? []) {
      out.push({ pack: pack.manifest.name, glob });
    }
  }
  return out;
}

/**
 * Evaluate the frontend trigger for the current change. Reads the git-reconciled changed
 * files (issue #450) and matches them against the active packs' frontend globs.
 */
export async function evaluateFrontendTrigger(projectRoot: string): Promise<FrontendTrigger> {
  const change = await loadChangeEvidence(projectRoot);
  const changed = change.files.map(toPosix);
  const globs = activeFrontendGlobs(projectRoot);

  const matchedFiles = new Set<string>();
  const matchedGlobs = new Set<string>();
  const packs = new Set<string>();

  if (change.source !== 'none') {
    for (const file of changed) {
      for (const { pack, glob } of globs) {
        if (matchesFrontendGlob(file, glob)) {
          matchedFiles.add(file);
          matchedGlobs.add(glob);
          packs.add(pack);
        }
      }
    }
  }

  return {
    triggered: matchedFiles.size > 0,
    matched_files: [...matchedFiles].sort(),
    matched_globs: [...matchedGlobs].sort(),
    packs: [...packs].sort(),
    changed_files: changed,
    source: change.source,
  };
}
