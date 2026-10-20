import { scanImports } from '@/graph/import-scanner.js';

export interface RepoEdge {
  from: string;
  to: string;
}

export const PAGERANK_DAMPING = 0.85;

export interface PageRankOptions {
  damping?: number;
  iterations?: number;
  tolerance?: number;
}

export function pageRank(
  seedNodes: readonly string[],
  edges: readonly RepoEdge[],
  options: PageRankOptions = {},
): Map<string, number> {
  const damping = options.damping ?? PAGERANK_DAMPING;
  const iterations = options.iterations ?? 50;
  const tolerance = options.tolerance ?? 1e-6;

  const nodes = new Set<string>(seedNodes);
  for (const edge of edges) {
    nodes.add(edge.from);
    nodes.add(edge.to);
  }
  const nodeList = [...nodes];
  const n = nodeList.length;
  if (n === 0) {
    return new Map();
  }

  const outLinks = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.from === edge.to) {
      continue;
    }
    const list = outLinks.get(edge.from) ?? [];
    list.push(edge.to);
    outLinks.set(edge.from, list);
  }

  let rank = new Map(nodeList.map((node) => [node, 1 / n]));
  const base = (1 - damping) / n;

  for (let iteration = 0; iteration < iterations; iteration++) {
    const next = new Map<string, number>(nodeList.map((node) => [node, base]));

    let danglingMass = 0;
    for (const node of nodeList) {
      const links = outLinks.get(node);
      if (!links || links.length === 0) {
        danglingMass += rank.get(node) ?? 0;
      }
    }
    const danglingShare = (damping * danglingMass) / n;

    for (const node of nodeList) {
      if (danglingShare > 0) {
        next.set(node, (next.get(node) ?? 0) + danglingShare);
      }
      const links = outLinks.get(node);
      if (!links || links.length === 0) {
        continue;
      }
      const contribution = (damping * (rank.get(node) ?? 0)) / links.length;
      for (const target of links) {
        next.set(target, (next.get(target) ?? 0) + contribution);
      }
    }

    let delta = 0;
    for (const node of nodeList) {
      delta += Math.abs((next.get(node) ?? 0) - (rank.get(node) ?? 0));
    }
    rank = next;
    if (delta < tolerance) {
      break;
    }
  }

  return rank;
}

export interface RepoFile {
  path: string;
  module?: string;
  symbols?: string[];
}

export interface RepoMapEntry {
  path: string;
  module?: string;
  symbols: string[];
  rank: number;
}

export interface RepoMapResult {
  entries: RepoMapEntry[];
  skeleton: string;
  truncated: boolean;
}

export const DEFAULT_REPO_MAP_TOKEN_BUDGET = 1500;

const MAX_SYMBOLS_PER_FILE = 6;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function formatEntryLine(entry: RepoMapEntry): string {
  const parts = [`- \`${entry.path}\``];
  if (entry.module) {
    parts.push(`· ${entry.module}`);
  }
  if (entry.symbols.length > 0) {
    parts.push(`· ${entry.symbols.slice(0, MAX_SYMBOLS_PER_FILE).join(', ')}`);
  }
  return parts.join(' ');
}

export function buildRepoMap(
  files: readonly RepoFile[],
  edges: readonly RepoEdge[],
  options: { tokenBudget?: number } = {},
): RepoMapResult {
  const tokenBudget = options.tokenBudget ?? DEFAULT_REPO_MAP_TOKEN_BUDGET;
  const ranks = pageRank(
    files.map((file) => file.path),
    edges,
  );

  const entries: RepoMapEntry[] = files
    .map((file) => ({
      path: file.path,
      module: file.module,
      symbols: file.symbols ?? [],
      rank: ranks.get(file.path) ?? 0,
    }))
    .sort((left, right) => {
      if (right.rank !== left.rank) {
        return right.rank - left.rank;
      }
      return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
    });

  if (entries.length === 0) {
    return { entries, skeleton: '', truncated: false };
  }

  const header = `## Repo map — ${entries.length} files ranked by structural importance\n> Embedding-free orientation. Use it to decide where to read or grep; verify against the live files.\n`;
  let tokens = estimateTokens(header);
  const lines: string[] = [];
  let truncated = false;

  for (const entry of entries) {
    const line = formatEntryLine(entry);
    const lineTokens = estimateTokens(line) + 1;
    if (lines.length > 0 && tokens + lineTokens > tokenBudget) {
      truncated = true;
      break;
    }
    lines.push(line);
    tokens += lineTokens;
  }

  const body = truncated
    ? `${lines.join('\n')}\n…[repo map truncated to fit the token budget]`
    : lines.join('\n');

  return { entries, skeleton: `${header}\n${body}\n`, truncated };
}

export interface BuildProjectRepoMapOptions {
  files: string[];
  aliases?: Record<string, string>;
  moduleOf?: (path: string) => string | undefined;
  symbolsOf?: (path: string) => string[] | undefined;
  tokenBudget?: number;
}

export async function buildProjectRepoMap(
  projectRoot: string,
  options: BuildProjectRepoMapOptions,
): Promise<RepoMapResult> {
  const edges = await scanImports({
    projectRoot,
    files: options.files,
    aliases: options.aliases ?? { '@/': 'src/' },
  });
  const files: RepoFile[] = options.files.map((path) => ({
    path,
    module: options.moduleOf?.(path),
    symbols: options.symbolsOf?.(path),
  }));
  return buildRepoMap(files, edges, { tokenBudget: options.tokenBudget });
}
