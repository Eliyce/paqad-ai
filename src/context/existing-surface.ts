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

export const EXISTING_SURFACE_HEADING = '## Existing surface';

export const EXISTING_SURFACE_FRAMING =
  '> Before writing new helpers, check this surface — these already exist in this project.';

export interface ExistingSurfaceCard {
  name: string;
  signature?: string;
  file: string;
  line?: number;
  callerCount?: number;
  module?: string;
}

export interface ComposeExistingSurfaceOptions {
  tokenBudget?: number;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

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

export function composeExistingSurfaceSection(
  cards: readonly ExistingSurfaceCard[],
  options: ComposeExistingSurfaceOptions = {},
): string {
  if (cards.length === 0) {
    return '';
  }
  const tokenBudget = options.tokenBudget ?? DEFAULT_EXISTING_SURFACE_TOKENS;

  let tokens = estimateTokens(EXISTING_SURFACE_FRAMING) + estimateTokens(headerFor(cards.length));
  const lines: string[] = [];
  let truncated = false;

  for (const card of cards) {
    const line = formatCardLine(card);
    const lineTokens = estimateTokens(line) + 1;
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
  changedPaths?: readonly string[];
  query?: string;
  tokenBudget?: number;
}

const SOURCE_EXT_RE = /\.(?:ts|tsx|js|jsx|mjs|cjs|php|dart)$/;

function toPosix(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '');
}

function modulePrefix(path: string): string {
  return path.split('/').slice(0, 2).join('/');
}

function basenameNoExt(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? base : base.slice(0, dot);
}

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

    const symbolsByFile = new Map<string, CodeKnowledgeIndex['symbols']>();
    if (index) {
      for (const symbol of index.symbols) {
        const list = symbolsByFile.get(symbol.file) ?? [];
        list.push(symbol);
        symbolsByFile.set(symbol.file, list);
      }
    }
    const moduleResolver = buildModuleRoleResolver(projectRoot);

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

function extractNames(projectRoot: string, relPath: string): string[] {
  try {
    const content = readFileSync(join(projectRoot, relPath), 'utf8');
    return extractSymbols(relPath, content).map((symbol) => symbol.name);
    /* v8 ignore next 3 -- candidates come from the working-tree scan so the read succeeds; this guard only covers a scan-then-delete race, not reproduced in tests */
  } catch {
    return [];
  }
}
