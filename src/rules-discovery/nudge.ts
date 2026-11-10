import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { DEFAULT_IGNORE_GLOBS, scanWorkingTree } from '@/core/fs/gitignore-scan.js';
import type { StackEcosystem } from '@/core/types/introspection.js';
import { createDefaultEcosystemParserRegistry } from '@/introspection/ecosystems/registry.js';

import { readOrSeedBaseline } from './baseline.js';
import { atomicWriteJson, readJsonFile } from './files.js';
import { packageKey } from './inventory.js';
import { RULES_DISCOVERY_NUDGE_STATE } from './paths.js';
import { findOpenRunId } from './run-store.js';

export const NUDGE_NAME_LIMIT = 64;
const SHOWN_NAMES = 3;

const NAME_FORMATS: Record<StackEcosystem, RegExp> = {
  node: /^(?:@[a-z0-9~-][a-z0-9._~-]*\/)?[a-z0-9~-][a-z0-9._~-]*$/,
  python: /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/,
  php: /^[a-z0-9](?:[_.-]?[a-z0-9]+)*\/[a-z0-9](?:(?:[_.]|-{1,2})?[a-z0-9]+)*$/,
  go: /^[A-Za-z0-9][A-Za-z0-9._~/-]*$/,
  rust: /^[A-Za-z0-9_-]+$/,
  ruby: /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
  jvm: /^[A-Za-z0-9._-]+:[A-Za-z0-9._-]+$/,
  dart: /^[a-z0-9_]+$/,
  dotnet: /^[A-Za-z0-9_][A-Za-z0-9._-]*$/,
};

export interface NudgeState {
  set_hash: string;
  shown_at: string;
  line: string;
}

export interface RulesDriftNudge {
  line: string;
  set_hash: string;
  count: number;
  names: string[];
  open_run: string | null;
}

export function isShowablePackageName(ecosystem: StackEcosystem, name: string): boolean {
  return name.length <= NUDGE_NAME_LIMIT && NAME_FORMATS[ecosystem].test(name);
}

function nodeNamesInOrder(text: string): string[] | null {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    return ['dependencies', 'devDependencies'].flatMap((field) => {
      const block = parsed[field];
      return block !== null && typeof block === 'object' ? Object.keys(block) : [];
    });
  } catch {
    return null;
  }
}

export function manifestPackageNames(
  projectRoot: string,
): Array<{ name: string; ecosystem: StackEcosystem }> {
  const parsers = createDefaultEcosystemParserRegistry().list();
  const patterns = Array.from(new Set(parsers.flatMap((parser) => parser.manifestFiles)));
  const files = scanWorkingTree(
    projectRoot,
    patterns.map((pattern) => `**/${pattern}`),
    DEFAULT_IGNORE_GLOBS,
  );
  const seen = new Set<string>();
  const out: Array<{ name: string; ecosystem: StackEcosystem }> = [];
  for (const file of files) {
    const name = basename(file);
    const parser = parsers.find((candidate) =>
      candidate.manifestFiles.some((pattern) =>
        pattern.startsWith('*') ? name.endsWith(pattern.slice(1)) : name === pattern,
      ),
    );
    if (parser === undefined) continue;
    const text = readFileSync(join(projectRoot, file), 'utf8');
    const names =
      (name === 'package.json' ? nodeNamesInOrder(text) : null) ??
      parser.parseManifest(text, name).packages.map((pkg) => pkg.name);
    for (const packageName of names) {
      const entry = { name: packageName, ecosystem: parser.ecosystem };
      if (!seen.has(packageKey(entry))) {
        seen.add(packageKey(entry));
        out.push(entry);
      }
    }
  }
  return out;
}

export function nudgeLine(count: number, names: readonly string[], openRun: string | null): string {
  const noun = count === 1 ? 'new package' : 'new packages';
  const shown = names.length === 0 ? '' : ` (${names.join(', ')})`;
  const ask = openRun
    ? "A rules discovery run is open: say 'discover rules' to continue it."
    : "Say 'discover rules' to update them.";
  return `Your rules may be behind: ${count} ${noun}${shown}. ${ask}`;
}

export function computeRulesDriftNudge(
  projectRoot: string,
  now: Date = new Date(),
): RulesDriftNudge | null {
  const baseline = readOrSeedBaseline(projectRoot, now);
  if (baseline === null) return null;
  const known = new Set(baseline.packages.map(packageKey));
  const added = manifestPackageNames(projectRoot).filter((pkg) => !known.has(packageKey(pkg)));
  if (added.length === 0) return null;
  const names = added
    .filter((pkg) => isShowablePackageName(pkg.ecosystem, pkg.name))
    .slice(0, SHOWN_NAMES)
    .map((pkg) => pkg.name);
  const setHash = createHash('sha256')
    .update(added.map(packageKey).sort().join('\n'))
    .digest('hex');
  const openRun = findOpenRunId(projectRoot);
  return {
    line: nudgeLine(added.length, names, openRun),
    set_hash: setHash,
    count: added.length,
    names,
    open_run: openRun,
  };
}

export function readNudgeState(projectRoot: string): NudgeState | null {
  const read = readJsonFile<NudgeState>(join(projectRoot, RULES_DISCOVERY_NUDGE_STATE));
  return read.state === 'ok' && typeof read.value.set_hash === 'string' ? read.value : null;
}

export function clearNudgeState(projectRoot: string): void {
  atomicWriteJson(join(projectRoot, RULES_DISCOVERY_NUDGE_STATE), {
    set_hash: '',
    shown_at: '',
    line: '',
  });
}

export function rulesDriftSessionStartText(
  projectRoot: string,
  now: Date = new Date(),
): string | null {
  const nudge = computeRulesDriftNudge(projectRoot, now);
  const state = readNudgeState(projectRoot);
  if (nudge === null) {
    if (state !== null && state.line !== '') clearNudgeState(projectRoot);
    return null;
  }
  const key = `${nudge.set_hash}:${nudge.open_run ?? ''}`;
  if (state?.set_hash === key) return null;
  atomicWriteJson(join(projectRoot, RULES_DISCOVERY_NUDGE_STATE), {
    set_hash: key,
    shown_at: now.toISOString(),
    line: nudge.line,
  } satisfies NudgeState);
  return nudge.line;
}

export function rulesDriftHeadline(projectRoot: string): string | null {
  const state = readNudgeState(projectRoot);
  return state === null || state.line === '' ? null : state.line;
}
