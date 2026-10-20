import { getRuntimeRoot } from '@/core/runtime-paths.js';
import { getPacksForFrameworks } from '@/packs/project-packs.js';
import { loadChangeEvidence } from '@/pipeline/change-evidence.js';
import { readProjectProfile } from '@/core/project-profile.js';
import { getPrimaryStack } from '@/core/stack-profile.js';

export interface FrontendTrigger {
  triggered: boolean;
  matched_files: string[];
  matched_globs: string[];
  packs: string[];
  changed_files: string[];
  source: 'git' | 'none';
}

export function frontendGlobToRegExp(glob: string): RegExp {
  let out = '';
  let braceDepth = 0;
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i]!;
    const next = glob[i + 1];
    if (ch === '*' && next === '*') {
      if (glob[i + 2] === '/') {
        out += '(?:.*/)?';
        i += 2;
      } else {
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

export function matchesFrontendGlob(file: string, glob: string): boolean {
  return frontendGlobToRegExp(glob).test(file);
}

function toPosix(file: string): string {
  return file.replace(/\\/g, '/');
}

function activeFrameworks(projectRoot: string): string[] {
  const profile = readProjectProfile(projectRoot);
  if (!profile) return [];
  const frameworks = profile.stack_profile?.frameworks ?? [];
  const primary = getPrimaryStack({ stack_profile: profile.stack_profile });
  return [...new Set([...frameworks, primary].filter((name): name is string => Boolean(name)))];
}

export class PackRegistryEmptyError extends Error {
  readonly runtimeRoot: string;
  readonly frameworks: string[];

  constructor(runtimeRoot: string, frameworks: string[]) {
    super(
      `paqad could not load its built-in stack packs (looked in ${runtimeRoot}) for ${frameworks.join(', ')}.`,
    );
    this.name = 'PackRegistryEmptyError';
    this.runtimeRoot = runtimeRoot;
    this.frameworks = frameworks;
  }
}

export function packRegistryFaultDetail(runtimeRoot: string): string {
  return `paqad could not load its built-in stack packs (looked in ${runtimeRoot}). This is an install fault, not a clean change.`;
}

export const PACK_REGISTRY_FAULT_REMEDIATION = 'run `paqad-ai doctor` and reinstall paqad-ai.';

export function activeFrontendGlobs(projectRoot: string): Array<{ pack: string; glob: string }> {
  const frameworks = activeFrameworks(projectRoot);
  const packs = getPacksForFrameworks(frameworks, projectRoot);
  if (frameworks.length > 0 && packs.length === 0) {
    throw new PackRegistryEmptyError(getRuntimeRoot(), frameworks);
  }
  const out: Array<{ pack: string; glob: string }> = [];
  for (const pack of packs) {
    for (const glob of pack.manifest.visual_evidence?.frontend_globs ?? []) {
      out.push({ pack: pack.manifest.name, glob });
    }
  }
  return out;
}

export function frontendFilesOf(projectRoot: string, changedFiles: readonly string[]): string[] {
  const globs = activeFrontendGlobs(projectRoot);
  const matched = changedFiles
    .map(toPosix)
    .filter((file) => globs.some(({ glob }) => matchesFrontendGlob(file, glob)));
  return [...new Set(matched)].sort();
}

export function frontendTriggerOrFault(
  projectRoot: string,
  changedFiles: string[],
): { triggered: boolean; files: string[]; fault: { runtimeRoot: string } | null } {
  try {
    const files = frontendFilesOf(projectRoot, changedFiles);
    return { triggered: files.length > 0, files, fault: null };
  } catch (error) {
    if (error instanceof PackRegistryEmptyError) {
      return { triggered: false, files: [], fault: { runtimeRoot: error.runtimeRoot } };
    }
    throw error;
  }
}

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
