/**
 * Existing-surface planning digest (issue #356).
 *
 * The single best-evidenced anti-duplication lever: before the model writes a new
 * helper, show it the exported symbols that already exist for the files/modules the
 * prompt and working set implicate. This wires the built-but-unconsumed repo-map
 * (`buildProjectRepoMap`, its first live consumer) into the session-context artifact
 * as a `## Existing surface` section — signature cards ranked by structural importance
 * (PageRank), capped at a hard token budget with an honest truncation line.
 *
 * Two data sources, in order (FR-3):
 *   1. the #353 code-knowledge index (`.paqad/indexes/code-knowledge.json`) — full
 *      signature + caller count + line + module per exported symbol; or
 *   2. the repo-map / symbol-extractor resolvers — name-only cards — when the index is
 *      absent, so the section works standalone before #353 has ever built.
 *
 * `composeExistingSurfaceSection` is pure (the format the AC-5 test pins);
 * `gatherExistingSurface` is the best-effort IO composer the background worker calls
 * on the feature-development route only. It never throws into the worker — any failure
 * degrades to an empty section (disabled == today).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { SOURCE_GLOBS } from '@/code-knowledge/builder.js';
import { readCodeKnowledgeIndex } from '@/code-knowledge/store.js';
import { extractSymbols } from '@/code-knowledge/symbol-extractor.js';
import type { CodeKnowledgeIndex } from '@/code-knowledge/types.js';
import { scanWorkingTree } from '@/core/fs/gitignore-scan.js';
import { DEFAULT_EXISTING_SURFACE_TOKENS } from '@/core/project-intelligence.js';
import { buildProjectRepoMap } from '@/rag/repo-map.js';
import { buildModuleRoleResolver } from '@/rag/contextual-blurb.js';

/** Heading of the injected section (pinned by the AC-5 format test). */
export const EXISTING_SURFACE_HEADING = '## Existing surface';

/** Framing line under the heading — verbatim per FR-5 (issue #356). */
export const EXISTING_SURFACE_FRAMING =
  '> Before writing new helpers, check this surface — these already exist in this project.';

/** One existing exported symbol, rendered as a signature card. */
export interface ExistingSurfaceCard {
  /** Exported identifier (the fallback when no signature is known). */
  name: string;
  /** Params + return where the index has it; omitted ⇒ the name alone is shown. */
  signature?: string;
  /** Project-relative, forward-slash defining file. */
  file: string;
  /** 1-based line of the export, when known. */
  line?: number;
  /** Distinct non-test callers, when known (from the code-knowledge index). */
  callerCount?: number;
  /** Owning module slug / role, when known. */
  module?: string;
}

export interface ComposeExistingSurfaceOptions {
  /** Hard token budget for the section (default {@link DEFAULT_EXISTING_SURFACE_TOKENS}). */
  tokenBudget?: number;
}

/** Cheap 4-bytes-per-token estimate, matching the repo-map / retrieval sections. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Render one card: `` `<signature|name>` — file:line · called from N places · module``. */
function formatCardLine(card: ExistingSurfaceCard): string {
  const head = card.signature?.trim() ? card.signature.trim() : card.name;
  const location = card.line ? `${card.file}:${card.line}` : card.file;
  const parts = [`- \`${head}\` — ${location}`];
  if (typeof card.callerCount === 'number') {
    parts.push(`· called from ${card.callerCount} ${card.callerCount === 1 ? 'place' : 'places'}`);
  }
  if (card.module) {
    parts.push(`· ${card.module}`);
  }
  return parts.join(' ');
}

function headerFor(shown: number): string {
  return `${EXISTING_SURFACE_HEADING} — ${shown} existing symbol${shown === 1 ? '' : 's'} for the files in play`;
}

/**
 * Compose the `## Existing surface` section from already-ranked cards. Cards are added
 * in the order given (the caller ranks them by repo-map PageRank) until the token
 * budget is hit; the rest are dropped and an honest truncation line names how many.
 * Returns `''` for an empty card list so the caller can append it unconditionally
 * without changing the rule-only output.
 */
export function composeExistingSurfaceSection(
  cards: readonly ExistingSurfaceCard[],
  options: ComposeExistingSurfaceOptions = {},
): string {
  if (cards.length === 0) {
    return '';
  }
  const tokenBudget = options.tokenBudget ?? DEFAULT_EXISTING_SURFACE_TOKENS;

  // Reserve the framing line and a header sized for ALL cards (an upper bound on the
  // shown count's digits), so the section never exceeds the budget even after the
  // header's final count is known.
  let tokens = estimateTokens(EXISTING_SURFACE_FRAMING) + estimateTokens(headerFor(cards.length));
  const lines: string[] = [];
  let truncated = false;

  for (const card of cards) {
    const line = formatCardLine(card);
    const lineTokens = estimateTokens(line) + 1;
    // Always show at least one card; past that, stop when the next line would overflow.
    if (lines.length > 0 && tokens + lineTokens > tokenBudget) {
      truncated = true;
      break;
    }
    lines.push(line);
    tokens += lineTokens;
  }

  const remaining = cards.length - lines.length;
  const trailer =
    truncated && remaining > 0
      ? `\n…and ${remaining} more exported symbol${remaining === 1 ? '' : 's'} — run \`paqad-ai index query <name>\` to look one up.`
      : '';
  return `${headerFor(lines.length)}\n${EXISTING_SURFACE_FRAMING}\n\n${lines.join('\n')}${trailer}\n`;
}

export interface GatherExistingSurfaceOptions {
  /** Working-set paths (the files being changed) — the primary relevance signal. */
  changedPaths?: readonly string[];
  /** The prompt text, used to pull in files/symbols it names beyond the working set. */
  query?: string;
  /** Token budget override (defaults to {@link DEFAULT_EXISTING_SURFACE_TOKENS}). */
  tokenBudget?: number;
}

const SOURCE_EXT_RE = /\.(?:ts|tsx|js|jsx|mjs|cjs|php|dart)$/;

function toPosix(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '');
}

/** First two path segments — the "module" a file belongs to (e.g. `src/context`). */
function modulePrefix(path: string): string {
  return path.split('/').slice(0, 2).join('/');
}

function basenameNoExt(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? base : base.slice(0, dot);
}

/**
 * Scope the file universe to what the working set + prompt implicate: the working-set
 * files, every file in a working-set module, and any file whose basename (or, with the
 * index, a defined symbol name) the prompt names. Nothing implicated ⇒ empty (the
 * section is then omitted — honest, and token-neutral).
 */
export function selectCandidateFiles(
  allFiles: readonly string[],
  workingSet: readonly string[],
  query: string,
  index: CodeKnowledgeIndex | null,
): string[] {
  const working = new Set(workingSet);
  const workingModules = new Set([...working].map(modulePrefix));
  if (working.size === 0 && query.trim().length === 0) {
    return [];
  }
  const queryLower = query.toLowerCase();
  const wanted = new Set<string>();
  for (const file of allFiles) {
    if (working.has(file) || (workingModules.size > 0 && workingModules.has(modulePrefix(file)))) {
      wanted.add(file);
      continue;
    }
    const base = basenameNoExt(file).toLowerCase();
    if (base.length >= 4 && queryLower.includes(base)) {
      wanted.add(file);
    }
  }
  // Symbol-name hits from the prompt (index only — the names are already loaded).
  if (index && queryLower.length > 0) {
    for (const symbol of index.symbols) {
      if (symbol.name.length >= 5 && queryLower.includes(symbol.name.toLowerCase())) {
        wanted.add(symbol.file);
      }
    }
  }
  const universe = new Set(allFiles);
  return [...wanted].filter((file) => universe.has(file));
}

/**
 * Compose the `## Existing surface` section for the current working set + prompt.
 * Best-effort: any failure (no scope, unreadable index, scan error) returns `''` so
 * the background worker is never wedged and the artifact stays byte-identical to today.
 */
export async function gatherExistingSurface(
  projectRoot: string,
  options: GatherExistingSurfaceOptions = {},
): Promise<string> {
  try {
    const tokenBudget = options.tokenBudget ?? DEFAULT_EXISTING_SURFACE_TOKENS;
    const query = options.query ?? '';
    const index = readCodeKnowledgeIndex(projectRoot);
    const workingSet = (options.changedPaths ?? [])
      .map(toPosix)
      .filter((path) => SOURCE_EXT_RE.test(path));

    const allFiles = index
      ? index.files.map((file) => file.path)
      : scanWorkingTree(projectRoot, SOURCE_GLOBS).map(toPosix);
    const candidates = selectCandidateFiles(allFiles, workingSet, query, index);
    if (candidates.length === 0) {
      return '';
    }

    // Symbols per file, keyed for O(1) lookup during card assembly.
    const symbolsByFile = new Map<string, CodeKnowledgeIndex['symbols']>();
    if (index) {
      for (const symbol of index.symbols) {
        const list = symbolsByFile.get(symbol.file) ?? [];
        list.push(symbol);
        symbolsByFile.set(symbol.file, list);
      }
    }
    const moduleResolver = buildModuleRoleResolver(projectRoot);

    // The repo-map's first live consumer (AC-5): rank the scoped candidate files by
    // structural importance (PageRank over their import edges). The `symbolsOf` resolver
    // supplies exported names for the name-only fallback path (no index).
    const repoMap = await buildProjectRepoMap(projectRoot, {
      files: candidates,
      moduleOf: (path) => moduleResolver(path),
      symbolsOf: index
        ? (path) => (symbolsByFile.get(path) ?? []).map((symbol) => symbol.name)
        : (path) => extractNames(projectRoot, path),
    });

    const cards: ExistingSurfaceCard[] = [];
    for (const entry of repoMap.entries) {
      if (index) {
        const symbols = (symbolsByFile.get(entry.path) ?? [])
          .slice()
          .sort((a, b) => b.caller_count - a.caller_count || a.name.localeCompare(b.name));
        for (const symbol of symbols) {
          cards.push({
            name: symbol.name,
            signature: symbol.signature,
            file: symbol.file,
            line: symbol.line,
            callerCount: symbol.caller_count,
            module: symbol.module_slug ?? entry.module ?? undefined,
          });
        }
      } else {
        for (const name of entry.symbols) {
          cards.push({ name, file: entry.path, module: entry.module });
        }
      }
    }

    return composeExistingSurfaceSection(cards, { tokenBudget });
    /* v8 ignore next 3 -- defensive best-effort guard; the readers above are all tolerant, so no test path throws here, but a surprise throw must never wedge the detached worker */
  } catch {
    return '';
  }
}

/** Read + regex-extract the exported names a file defines (name-only fallback path). */
function extractNames(projectRoot: string, relPath: string): string[] {
  try {
    const content = readFileSync(join(projectRoot, relPath), 'utf8');
    return extractSymbols(relPath, content).map((symbol) => symbol.name);
    /* v8 ignore next 3 -- candidates come from the working-tree scan so the read succeeds; this guard only covers a scan-then-delete race, not reproduced in tests */
  } catch {
    return [];
  }
}
