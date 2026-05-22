import { existsSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { extname, join, relative, sep } from 'node:path';

import { VERSION } from '@/index.js';
import { PATHS } from '@/core/constants/paths.js';
import type { ChunkIndex, ChunkIndexEntry, Chunk } from '@/context/types.js';

import { scanImports } from './import-scanner.js';
import type {
  Graph,
  GraphEdge,
  GraphNode,
  GraphOverlaysAvailable,
  ModuleHealthTier,
} from './types.js';

export interface ExtractOptions {
  projectRoot: string;
}

export interface ChunkContentRecord {
  chunkId: string;
  fileRelPath: string;
  fileId: string;
  chunkIndex: number;
  content: string;
}

export interface GraphExtraction {
  graph: Graph;
  chunkContents: Map<string, ChunkContentRecord>;
  /** Maps vector store item id (chunk content hash id) → chunk graph node id. */
  vectorIdToNodeId: Map<string, string>;
}

interface ModuleHealthFile {
  module: string;
  tier: ModuleHealthTier | string;
  metrics?: {
    defect_frequency?: number | null;
    contract_stability?: number | null;
    coverage_pct?: number | null;
    change_velocity?: number | null;
  };
  updated_at?: string;
  risk_floor?: number | null;
  complexity_correction?: number | null;
}

interface OnboardingManifest {
  framework_version?: string;
  project_root?: string;
  profile?: {
    project?: { name?: string; id?: string };
  };
}

const KNOWN_TIERS: ReadonlySet<ModuleHealthTier> = new Set(['green', 'amber', 'red', 'unknown']);

function normaliseTier(value: unknown): ModuleHealthTier {
  return typeof value === 'string' && KNOWN_TIERS.has(value as ModuleHealthTier)
    ? (value as ModuleHealthTier)
    : 'unknown';
}

function languageFromExtension(filePath: string): string | null {
  const ext = extname(filePath).toLowerCase();
  if (!ext) return null;
  const map: Record<string, string> = {
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    '.py': 'python',
    '.rb': 'ruby',
    '.go': 'go',
    '.rs': 'rust',
    '.java': 'java',
    '.kt': 'kotlin',
    '.swift': 'swift',
    '.cs': 'csharp',
    '.cpp': 'cpp',
    '.c': 'c',
    '.h': 'c',
    '.json': 'json',
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.md': 'markdown',
    '.html': 'html',
    '.css': 'css',
    '.sh': 'shell',
  };
  return map[ext] ?? null;
}

function toProjectRelative(projectRoot: string, absolutePath: string): string {
  const rel = relative(projectRoot, absolutePath);
  return rel === '' ? '.' : rel.split(sep).join('/');
}

function moduleNameForFile(relativePath: string, knownModules: ReadonlySet<string>): string | null {
  const parts = relativePath.split('/');
  if (parts.length < 2) return null;
  if (parts[0] !== 'src') return null;
  const candidate = parts[1]!;
  return knownModules.has(candidate) ? candidate : null;
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    const raw = await readFile(path, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function loadModuleHealth(
  projectRoot: string,
): Promise<{ entries: ModuleHealthFile[]; available: boolean }> {
  const dir = join(projectRoot, PATHS.PLANNING_MODULE_HEALTH_DIR);
  if (!existsSync(dir)) {
    return { entries: [], available: false };
  }
  let files: string[] = [];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
  } catch {
    return { entries: [], available: false };
  }
  const entries: ModuleHealthFile[] = [];
  for (const f of files) {
    const data = await readJson<ModuleHealthFile>(join(dir, f));
    if (data && typeof data.module === 'string') {
      entries.push(data);
    }
  }
  return { entries, available: files.length > 0 };
}

interface DefectEntry {
  module?: string;
  modules?: string[];
  affected_modules?: string[];
}

async function loadDefectCounts(
  projectRoot: string,
): Promise<{ counts: Map<string, number>; available: boolean }> {
  const dir = join(projectRoot, '.paqad/defect-patterns/entries');
  const counts = new Map<string, number>();
  if (!existsSync(dir)) {
    return { counts, available: false };
  }
  let files: string[] = [];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
  } catch {
    return { counts, available: false };
  }
  for (const f of files) {
    const data = await readJson<DefectEntry>(join(dir, f));
    if (!data) continue;
    const mods = new Set<string>();
    if (data.module) mods.add(data.module);
    for (const m of data.modules ?? []) mods.add(m);
    for (const m of data.affected_modules ?? []) mods.add(m);
    for (const m of mods) counts.set(m, (counts.get(m) ?? 0) + 1);
  }
  return { counts, available: true };
}

export async function extractGraph(options: ExtractOptions): Promise<Graph> {
  return (await extractGraphWithSidecar(options)).graph;
}

export async function extractGraphWithSidecar(
  options: ExtractOptions,
): Promise<GraphExtraction> {
  const projectRoot = options.projectRoot;
  const degradedReasons: string[] = [];

  const manifestPath = join(projectRoot, PATHS.ONBOARDING_MANIFEST);
  const manifest = await readJson<OnboardingManifest>(manifestPath);
  if (!manifest) {
    throw new Error(
      `Missing or unreadable onboarding manifest at ${manifestPath}. Run \`paqad-ai onboard\` first.`,
    );
  }

  if (manifest.framework_version && manifest.framework_version !== VERSION) {
    const manifestMajor = majorVersion(manifest.framework_version);
    const runtimeMajor = majorVersion(VERSION);
    if (manifestMajor !== runtimeMajor) {
      degradedReasons.push(
        `paqad-ai version mismatch: artefacts were written by ${manifest.framework_version}, runtime is ${VERSION}. Re-run \`paqad-ai onboard\` to refresh.`,
      );
    }
  }

  const chunkIndexPath = join(projectRoot, PATHS.CHUNK_INDEX);
  const chunkIndex = await readJson<ChunkIndex>(chunkIndexPath);
  if (!chunkIndex) {
    degradedReasons.push('chunk-index missing — file and chunk nodes unavailable');
  }

  const { entries: healthEntries, available: healthAvailable } = await loadModuleHealth(projectRoot);
  if (!healthAvailable) {
    degradedReasons.push('module health ledger missing — health overlay disabled');
  }

  const { counts: defectCounts, available: defectsAvailable } = await loadDefectCounts(projectRoot);
  if (!defectsAvailable) {
    degradedReasons.push('defect pattern store missing — defect overlay disabled');
  }

  const vectorMetaPath = join(projectRoot, PATHS.VECTOR_META);
  const vectorMetaPresent = existsSync(vectorMetaPath);
  if (!vectorMetaPresent) {
    degradedReasons.push('vector store missing — similarity edges disabled');
  }

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const moduleIds = new Set<string>();
  const moduleNames = new Set<string>(healthEntries.map((e) => e.module));

  for (const entry of healthEntries) {
    const id = `module:${entry.module}`;
    moduleIds.add(id);
    nodes.push({
      id,
      type: 'module',
      label: entry.module,
      parent_id: null,
      attributes: {
        health_tier: normaliseTier(entry.tier),
        defect_count: defectCounts.get(entry.module) ?? (defectsAvailable ? 0 : null),
        risk_floor: entry.risk_floor ?? null,
        complexity_correction: entry.complexity_correction ?? null,
      },
    });
  }

  const fileIds = new Map<string, string>();
  const chunkContents = new Map<string, ChunkContentRecord>();
  const vectorIdToNodeId = new Map<string, string>();
  let chunkCounter = 0;
  let symbolCount = 0;
  if (chunkIndex) {
    for (const fileEntry of chunkIndex.entries) {
      const relPath = toProjectRelative(projectRoot, fileEntry.source_file);
      const fileId = `file:${relPath}`;
      const moduleName = moduleNameForFile(relPath, moduleNames);
      const moduleId = moduleName ? `module:${moduleName}` : null;
      const exportedCount = countExportedSymbols(fileEntry);
      let sizeBytes: number | null = null;
      try {
        const s = await stat(fileEntry.source_file);
        sizeBytes = s.size;
      } catch {
        sizeBytes = null;
      }
      nodes.push({
        id: fileId,
        type: 'file',
        label: relPath,
        parent_id: moduleId,
        attributes: {
          language: languageFromExtension(relPath),
          symbol_count: exportedCount,
          size_bytes: sizeBytes,
        },
      });
      fileIds.set(relPath, fileId);
      if (moduleId) {
        edges.push({
          id: `e:contains:${moduleId}->${fileId}`,
          type: 'contains',
          source: moduleId,
          target: fileId,
          weight: null,
          attributes: { depth: null },
        });
      }
      const fileSymbols = new Set<string>();
      for (let i = 0; i < fileEntry.chunks.length; i++) {
        const chunk = fileEntry.chunks[i]!;
        const chunkId = `chunk:${relPath}#${i}`;
        nodes.push({
          id: chunkId,
          type: 'chunk',
          label: `${relPath}#${i}`,
          parent_id: fileId,
          attributes: {
            chunk_index: i,
            start_line: null,
            end_line: null,
            content_hash: chunk.content_hash,
            ast_node_type: chunk.ast_node_type,
          },
        });
        edges.push({
          id: `e:contains:${fileId}->${chunkId}`,
          type: 'contains',
          source: fileId,
          target: chunkId,
          weight: null,
          attributes: { depth: null },
        });
        chunkContents.set(chunkId, {
          chunkId,
          fileRelPath: relPath,
          fileId,
          chunkIndex: i,
          content: chunk.content ?? '',
        });
        if (chunk.id) vectorIdToNodeId.set(chunk.id, chunkId);
        for (const sym of chunk.exported_symbols ?? []) {
          if (!sym || fileSymbols.has(sym)) continue;
          fileSymbols.add(sym);
        }
        chunkCounter += 1;
      }
      for (const sym of fileSymbols) {
        const symbolId = `symbol:${relPath}#${sym}`;
        nodes.push({
          id: symbolId,
          type: 'symbol',
          label: sym,
          parent_id: fileId,
          attributes: { exported: true },
        });
        edges.push({
          id: `e:defines:${fileId}->${symbolId}`,
          type: 'defines',
          source: fileId,
          target: symbolId,
          weight: null,
          attributes: { depth: null },
        });
        symbolCount += 1;
      }
    }
  }

  // Resolve imports across in-graph source files.
  const sourceFiles = Array.from(fileIds.keys()).filter((f) =>
    /\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(f),
  );
  let importCount = 0;
  if (sourceFiles.length > 0) {
    const importEdges = await scanImports({
      projectRoot,
      files: sourceFiles,
      aliases: { '@/': 'src/' },
    });
    for (const e of importEdges) {
      const sourceId = fileIds.get(e.from);
      const targetId = fileIds.get(e.to);
      if (!sourceId || !targetId || sourceId === targetId) continue;
      edges.push({
        id: `e:imports:${sourceId}->${targetId}`,
        type: 'imports',
        source: sourceId,
        target: targetId,
        weight: null,
        attributes: { depth: null },
      });
      importCount += 1;
    }
  }

  const overlays: GraphOverlaysAvailable = {
    health: healthAvailable,
    defects: defectsAvailable,
    risk_floor: healthEntries.some((e) => e.risk_floor != null),
    complexity_correction: healthEntries.some((e) => e.complexity_correction != null),
  };

  const fileCount = fileIds.size;

  const graph: Graph = {
    meta: {
      project_root: projectRoot,
      extracted_at: new Date().toISOString(),
      paqad_version: VERSION,
      counts: {
        modules: moduleIds.size,
        files: fileCount,
        chunks: chunkCounter,
        symbols: symbolCount,
        imports: importCount,
      },
      similarity_edges_available: vectorMetaPresent,
      overlays_available: overlays,
      degraded_reasons: degradedReasons,
    },
    nodes,
    edges,
  };

  return { graph, chunkContents, vectorIdToNodeId };
}

function majorVersion(v: string): string {
  const m = /^(\d+)/.exec(v.trim());
  return m ? m[1]! : v;
}

function countExportedSymbols(entry: ChunkIndexEntry): number {
  let count = 0;
  for (const c of entry.chunks as Chunk[]) {
    count += c.exported_symbols?.length ?? 0;
  }
  return count;
}
