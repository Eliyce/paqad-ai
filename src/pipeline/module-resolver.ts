import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';

import { ChunkIndexManager } from '@/context/chunk-index.js';
import { stripTrailingChars } from '@/core/path-utils.js';
import type { ProjectProfile } from '@/core/types/project-profile.js';
import type { AffectedModule } from '@/core/types/pre-classification.js';
import { RagService } from '@/rag/service.js';

const PATH_REGEX =
  /\b(?:src|app|resources|database|routes|lib|tests|docs|packages)\/[A-Za-z0-9_./-]+\b/g;
const KNOWN_EXTENSIONS =
  /\.(tsx?|jsx?|vue|svelte|astro|php|dart|py|rb|go|rs|java|kt|cs|md|json|ya?ml)$/i;

export interface ModuleResolutionResult {
  modules: AffectedModule[];
  source: string;
}

export class ModuleResolver {
  constructor(
    private readonly root: string,
    private readonly profile?: Pick<ProjectProfile, 'intelligence' | 'stack_profile'>,
  ) {}

  async resolve(requestText: string): Promise<ModuleResolutionResult> {
    const explicit = await this.resolveExplicitPaths(requestText);
    if (explicit.length > 0) {
      return { modules: dedupeModules(explicit).slice(0, 8), source: 'explicit-path' };
    }

    const symbols = await this.resolveSymbols(requestText);
    if (symbols.length > 0) {
      return { modules: dedupeModules(symbols).slice(0, 8), source: 'symbol-index' };
    }

    const rag = await this.resolveRagMatches(requestText, explicit);
    if (rag.length > 0) {
      return { modules: dedupeModules(rag).slice(0, 8), source: 'rag' };
    }

    const heuristics = this.resolveHeuristicModules(requestText);
    return {
      modules: dedupeModules(heuristics).slice(0, 8),
      source: heuristics.length > 0 ? 'stack-heuristic' : 'default',
    };
  }

  private async resolveExplicitPaths(requestText: string): Promise<AffectedModule[]> {
    const matches = requestText.match(PATH_REGEX) ?? [];
    const resolved: AffectedModule[] = [];

    for (const match of matches) {
      const normalized = stripTrailingChars(match.replace(/\\/g, '/'), '.,:;!?');
      const absolute = join(this.root, normalized);
      if (existsSync(absolute)) {
        resolved.push({
          path: trimKnownExtension(normalized),
          source: 'explicit-path',
          confidence: 1,
        });
        continue;
      }

      const maybeResolved = await this.tryResolveByBasename(normalized);
      if (maybeResolved) {
        resolved.push(maybeResolved);
      }
    }

    return resolved;
  }

  private async tryResolveByBasename(candidate: string): Promise<AffectedModule | null> {
    const parent = join(this.root, candidate.split('/').slice(0, -1).join('/'));
    const leaf = basename(candidate);
    try {
      const entries = await readdir(parent);
      const match = entries.find((entry) => trimKnownExtension(entry) === trimKnownExtension(leaf));
      if (!match) {
        return null;
      }

      return {
        path: trimKnownExtension(join(relative(this.root, parent), match).replace(/\\/g, '/')),
        source: 'explicit-path',
        confidence: 0.95,
      };
    } catch {
      return null;
    }
  }

  private async resolveSymbols(requestText: string): Promise<AffectedModule[]> {
    const symbolTokens = Array.from(
      new Set(
        requestText.match(/\b[A-Z][A-Za-z0-9]+(?:Controller|Service|Model|Repository)\b/g) ?? [],
      ),
    );
    if (symbolTokens.length === 0) {
      return [];
    }

    const index = await new ChunkIndexManager(this.root).load();
    if (!index) {
      return [];
    }

    const matches: AffectedModule[] = [];
    for (const entry of index.entries) {
      const exported = new Set(entry.chunks.flatMap((chunk) => chunk.exported_symbols));
      if (symbolTokens.some((token) => exported.has(token))) {
        matches.push({
          path: trimKnownExtension(relative(this.root, entry.source_file).replace(/\\/g, '/')),
          source: 'symbol-index',
          confidence: 0.9,
        });
      }
    }

    return matches;
  }

  private async resolveRagMatches(
    requestText: string,
    explicit: AffectedModule[],
  ): Promise<AffectedModule[]> {
    if (!this.profile?.intelligence?.rag_enabled || explicit.length > 0) {
      return [];
    }

    try {
      const rag = new RagService(this.root);
      const result = await rag.retrieveForEval({
        keywords: requestText.split(/\s+/).slice(0, 8),
        taskDescription: requestText,
      });

      return result.retrieved_chunks
        .slice(0, 5)
        .map((chunk) => ({
          path: trimKnownExtension(relative(this.root, chunk.source_file).replace(/\\/g, '/')),
          source: 'rag' as const,
          confidence: 0.7,
        }))
        .filter((entry) => entry.path !== '');
    } catch {
      return [];
    }
  }

  private resolveHeuristicModules(requestText: string): AffectedModule[] {
    const request = requestText.toLowerCase();
    const framework = this.profile?.stack_profile?.frameworks?.[0] ?? 'laravel';
    const results: AffectedModule[] = [];

    if (/(migration|schema|table|column)/.test(request)) {
      results.push({ path: 'database/migrations', source: 'stack-heuristic', confidence: 0.7 });
    }

    if (/(api|endpoint|route|controller)/.test(request)) {
      for (const path of apiPrefixesForFramework(framework)) {
        results.push({ path, source: 'stack-heuristic', confidence: 0.7 });
      }
    }

    if (/(dashboard|page|screen|view)/.test(request)) {
      for (const path of screenPrefixesForFramework(framework)) {
        results.push({ path, source: 'stack-heuristic', confidence: 0.7 });
      }
    }

    if (/(component|button|form|widget)/.test(request)) {
      for (const path of componentPrefixesForFramework(framework)) {
        results.push({ path, source: 'stack-heuristic', confidence: 0.7 });
      }
    }

    return results;
  }
}

function dedupeModules(modules: AffectedModule[]): AffectedModule[] {
  const byPath = new Map<string, AffectedModule>();
  for (const entry of modules) {
    const current = byPath.get(entry.path);
    if (!current || entry.confidence > current.confidence) {
      byPath.set(entry.path, entry);
    }
  }

  return Array.from(byPath.values());
}

function trimKnownExtension(filePath: string): string {
  return stripTrailingChars(filePath.replace(KNOWN_EXTENSIONS, ''), '/');
}

function apiPrefixesForFramework(framework: string): string[] {
  switch (framework) {
    case 'laravel':
      return ['app/Http/Controllers', 'routes'];
    case 'flutter':
      return ['lib/services'];
    default:
      return ['src/api', 'src/server'];
  }
}

function screenPrefixesForFramework(framework: string): string[] {
  switch (framework) {
    case 'laravel':
      return ['resources/views', 'resources/js/pages'];
    case 'flutter':
      return ['lib/screens'];
    default:
      return ['src/pages', 'src/screens'];
  }
}

function componentPrefixesForFramework(framework: string): string[] {
  switch (framework) {
    case 'laravel':
      return ['resources/js/components', 'app/View/Components'];
    case 'flutter':
      return ['lib/widgets'];
    default:
      return ['src/components'];
  }
}
