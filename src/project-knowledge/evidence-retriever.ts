import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import fg from 'fast-glob';

import { toPosixPath } from '@/core/path-utils.js';
import { RagService } from '@/rag/service.js';

import type { AnswerQuery, CitationSourceClass } from './types.js';

export interface EvidenceFile {
  path: string;
  source_class: CitationSourceClass;
  excerpt: string;
  score: number;
}

const STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'is',
  'it',
  'in',
  'on',
  'at',
  'to',
  'of',
  'for',
  'and',
  'or',
  'but',
  'not',
  'with',
  'this',
  'that',
  'are',
  'was',
  'be',
  'by',
  'as',
  'do',
  'how',
  'what',
  'where',
  'which',
  'who',
  'when',
  'why',
  'has',
  'have',
  'from',
  'any',
  'all',
  'its',
]);

export function extractKeywords(question: string): string[] {
  if (!question) return [];
  return question
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9-]/g, ''))
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
}

export function scoreFile(filePath: string, excerpt: string, keywords: string[]): number {
  if (keywords.length === 0) return 0;
  const haystack = (filePath + ' ' + excerpt).toLowerCase();
  return keywords.reduce((acc, kw) => acc + (haystack.includes(kw) ? 1 : 0), 0);
}

function buildExcerpt(content: string, keywords: string[]): string {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (normalized.length === 0) return '';

  const lowered = normalized.toLowerCase();
  const firstMatchIndex = keywords
    .map((keyword) => lowered.indexOf(keyword))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];

  if (firstMatchIndex === undefined) {
    return normalized.slice(0, EXCERPT_LENGTH);
  }

  const start = Math.max(0, firstMatchIndex - 120);
  const end = Math.min(normalized.length, firstMatchIndex + EXCERPT_LENGTH);
  return normalized.slice(start, end).trim();
}

interface GlobPattern {
  pattern: string;
  source_class: CitationSourceClass;
}

const EVIDENCE_PATTERNS: GlobPattern[] = [
  { pattern: 'docs/modules/**/*.md', source_class: 'canonical-doc' },
  { pattern: 'docs/instructions/**/*.md', source_class: 'generated-instruction' },
  { pattern: '.paqad/**/*.{json,yaml,yml}', source_class: 'framework-state' },
  {
    pattern: '{package.json,composer.json,go.mod,Cargo.toml,pyproject.toml,pom.xml}',
    source_class: 'manifest',
  },
  { pattern: '.github/workflows/**/*.{yml,yaml}', source_class: 'workflow' },
  { pattern: 'src/**/*.{ts,js}', source_class: 'code' },
  { pattern: 'app/**/*.{ts,js}', source_class: 'code' },
  { pattern: 'lib/**/*.{ts,js}', source_class: 'code' },
];

const MAX_RESULTS = 6;
const EXCERPT_LENGTH = 500;
const SOURCE_CLASS_ORDER = EVIDENCE_PATTERNS.map((pattern) => pattern.source_class);

function classifySource(rawRelativePath: string): CitationSourceClass | null {
  // Chunk source files may carry native separators on Windows; the prefix
  // checks below are all posix-shaped.
  const relativePath = toPosixPath(rawRelativePath);
  if (relativePath.startsWith('docs/modules/') && relativePath.endsWith('.md')) {
    return 'canonical-doc';
  }
  if (relativePath.startsWith('docs/instructions/') && relativePath.endsWith('.md')) {
    return 'generated-instruction';
  }
  if (relativePath.startsWith('.paqad/')) {
    return 'framework-state';
  }
  if (
    ['package.json', 'composer.json', 'go.mod', 'Cargo.toml', 'pyproject.toml', 'pom.xml'].includes(
      relativePath,
    )
  ) {
    return 'manifest';
  }
  if (
    relativePath.startsWith('.github/workflows/') &&
    (relativePath.endsWith('.yml') || relativePath.endsWith('.yaml'))
  ) {
    return 'workflow';
  }
  if (
    /^src\/.*\.(ts|js)$/.test(relativePath) ||
    /^app\/.*\.(ts|js)$/.test(relativePath) ||
    /^lib\/.*\.(ts|js)$/.test(relativePath)
  ) {
    return 'code';
  }

  return null;
}

export class EvidenceRetriever {
  async retrieve(query: AnswerQuery): Promise<EvidenceFile[]> {
    const keywords = extractKeywords(query.question);
    if (keywords.length === 0) return [];

    const semanticCandidates = await this.retrieveSemanticEvidence(query, keywords);
    const lexicalCandidates = await this.retrieveLexicalEvidence(query, keywords);
    const merged = new Map<string, EvidenceFile>();

    for (const candidate of [...semanticCandidates, ...lexicalCandidates]) {
      const existing = merged.get(candidate.path);
      if (!existing || candidate.score > existing.score) {
        merged.set(candidate.path, candidate);
      }
    }

    const MCP_SOURCE_CLASS: CitationSourceClass = 'framework-state';
    const candidates = [...merged.values()];
    candidates.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (query.mcp_first) {
        const aMcp = a.source_class === MCP_SOURCE_CLASS ? 0 : 1;
        const bMcp = b.source_class === MCP_SOURCE_CLASS ? 0 : 1;
        if (aMcp !== bMcp) return aMcp - bMcp;
      }
      return (
        SOURCE_CLASS_ORDER.indexOf(a.source_class) - SOURCE_CLASS_ORDER.indexOf(b.source_class)
      );
    });

    return candidates.slice(0, MAX_RESULTS);
  }

  private async retrieveSemanticEvidence(
    query: AnswerQuery,
    keywords: string[],
  ): Promise<EvidenceFile[]> {
    const rag = new RagService(query.project_root);
    const status = await rag.getStatus();
    if (!status.enabled || !status.index_present || !status.valid) {
      return [];
    }

    const result = await rag.retrieveForEval(
      {
        taskDescription: query.question,
        keywords,
      },
      MAX_RESULTS,
    );

    const seen = new Set<string>();
    const candidates: EvidenceFile[] = [];

    for (const chunk of result.retrieved_chunks) {
      if (seen.has(chunk.source_file)) {
        continue;
      }

      const sourceClass = classifySource(chunk.source_file);
      if (!sourceClass) {
        continue;
      }

      seen.add(chunk.source_file);
      candidates.push({
        path: toPosixPath(chunk.source_file),
        source_class: sourceClass,
        excerpt: buildExcerpt(chunk.content, keywords),
        score: Math.max(scoreFile(chunk.source_file, chunk.content, keywords), 1),
      });
    }

    return candidates;
  }

  private async retrieveLexicalEvidence(
    query: AnswerQuery,
    keywords: string[],
  ): Promise<EvidenceFile[]> {
    const candidates: EvidenceFile[] = [];

    for (const { pattern, source_class } of EVIDENCE_PATTERNS) {
      const paths = await fg(pattern, {
        cwd: query.project_root,
        absolute: false,
        dot: true,
      });

      for (const relativePath of paths) {
        const absolutePath = join(query.project_root, relativePath);
        let excerpt = '';
        let score = 0;
        try {
          const content = await readFile(absolutePath, 'utf8');
          score = scoreFile(relativePath, content, keywords);
          if (score <= 0) {
            continue;
          }
          excerpt = buildExcerpt(content, keywords);
        } catch {
          // unreadable file — skip excerpt
        }
        if (score <= 0) {
          continue;
        }
        candidates.push({ path: relativePath, source_class, excerpt, score });
      }
    }

    return candidates;
  }
}
