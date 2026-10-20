import type { CodeKnowledgeIndex } from '@/code-knowledge/types.js';
import { readCodeKnowledgeIndex } from '@/code-knowledge/store.js';
import { AstChunker } from '@/context/ast-chunker.js';

import {
  loadCorpus,
  meaningfulLineCount,
  readFileText,
  resolveChunkLineRange,
  type CorpusChunk,
} from './corpus.js';
import {
  HEURISTIC_BAND_FLOOR,
  resolveDuplicationConfig,
  type DuplicationConfig,
} from './config.js';
import { collectAddedRanges, rangesOverlap, type LineRange } from './hunks.js';
import { corroborateWithJscpd, isCorroborated, type JscpdLocationKey } from './jscpd.js';
import { shingles, tokenizeCode, jaccard } from './token-similarity.js';
import { duplicationMessage, type DuplicationFinding } from './types.js';

const SIZE_RATIO_GUARD = 3;

export interface DetectOptions {
  projectRoot: string;
  changedFiles: string[];
  config?: DuplicationConfig;
  corroborate?: boolean;
}

interface IndexedCorpusChunk {
  chunk: CorpusChunk;
  shingleSet: Set<string>;
}

export async function detectNewCodeDuplication(
  options: DetectOptions,
): Promise<DuplicationFinding[]> {
  const config = options.config ?? resolveDuplicationConfig(options.projectRoot);
  if (config.mode === 'off' || options.changedFiles.length === 0) {
    return [];
  }
  const minLines = config.minLines;

  const addedByFile = new Map(
    (await collectAddedRanges(options)).map((entry) => [entry.file, entry.ranges]),
  );
  if (![...addedByFile.values()].some((ranges) => ranges.length > 0)) {
    return [];
  }

  const corpus = await loadCorpus(options);
  const indexedCorpus = indexCorpus(corpus, minLines);
  if (indexedCorpus.length === 0) {
    return [];
  }

  const knowledge = readCodeKnowledgeIndex(options.projectRoot);
  const jscpdKeys =
    options.corroborate === false
      ? new Set<JscpdLocationKey>()
      : await corroborateWithJscpd(options);

  const findings: DuplicationFinding[] = [];
  for (const [file, ranges] of addedByFile) {
    if (ranges.length === 0) {
      continue;
    }
    const fileText = await readFileText(options.projectRoot, file);
    /* c8 ignore next 3 -- `file` came from the added-ranges map, so it existed when its ranges
       were computed a moment ago; an unreadable file here is a mid-run race, guarded only. */
    if (fileText === null) {
      continue;
    }
    for (const candidate of new AstChunker().chunk(file, fileText)) {
      const finding = await scoreCandidate({
        projectRoot: options.projectRoot,
        file,
        fileText,
        candidateContent: candidate.content,
        ranges,
        minLines,
        threshold: config.similarityThreshold,
        indexedCorpus,
        knowledge,
        jscpdKeys,
      });
      if (finding) {
        findings.push(finding);
      }
    }
  }

  return dedupeFindings(findings);
}

function indexCorpus(corpus: CorpusChunk[], minLines: number): IndexedCorpusChunk[] {
  const indexed: IndexedCorpusChunk[] = [];
  for (const chunk of corpus) {
    if (meaningfulLineCount(chunk.content) < minLines) {
      continue;
    }
    indexed.push({ chunk, shingleSet: shingles(tokenizeCode(chunk.content)) });
  }
  return indexed;
}

interface ScoreInput {
  projectRoot: string;
  file: string;
  fileText: string;
  candidateContent: string;
  ranges: LineRange[];
  minLines: number;
  threshold: number;
  indexedCorpus: IndexedCorpusChunk[];
  knowledge: CodeKnowledgeIndex | null;
  jscpdKeys: Set<JscpdLocationKey>;
}

async function scoreCandidate(input: ScoreInput): Promise<DuplicationFinding | null> {
  const range = resolveChunkLineRange(input.fileText, input.candidateContent);
  /* c8 ignore next 3 -- the candidate content is a chunk of fileText itself, so it always
     resolves; the guard is defensive against a future chunker that rewrites content. */
  if (!range) {
    return null;
  }
  if (!rangesOverlap(range.start, range.end, input.ranges)) {
    return null;
  }
  if (meaningfulLineCount(input.candidateContent) < input.minLines) {
    return null;
  }

  const candidateShingles = shingles(tokenizeCode(input.candidateContent));
  const candidateChars = nonWhitespaceLength(input.candidateContent);
  const best = bestMatch(candidateShingles, candidateChars, input.indexedCorpus);
  if (!best || best.score < HEURISTIC_BAND_FLOOR) {
    return null;
  }

  const matchedFileText = await readFileText(input.projectRoot, best.chunk.file);
  const matchedRange =
    (matchedFileText && resolveChunkLineRange(matchedFileText, best.chunk.content)) || range;
  const { symbol, callers } = enrichMatch(input.knowledge, best.chunk, matchedRange);

  const kind = best.score >= input.threshold ? 'deterministic' : 'heuristic';
  return {
    file: input.file,
    line_range: range,
    matched_file: best.chunk.file,
    ...(symbol ? { matched_symbol: symbol } : {}),
    matched_line_range: matchedRange,
    similarity: best.score,
    matched_callers: callers,
    corroborated: isCorroborated(input.file, range.start, range.end, input.jscpdKeys),
    kind,
    message: duplicationMessage({
      file: input.file,
      lineRange: range,
      matchedFile: best.chunk.file,
      matchedSymbol: symbol,
      matchedLineRange: matchedRange,
      similarity: best.score,
      matchedCallers: callers,
    }),
  };
}

function bestMatch(
  candidateShingles: Set<string>,
  candidateChars: number,
  indexedCorpus: IndexedCorpusChunk[],
): { chunk: CorpusChunk; score: number } | null {
  let best: { chunk: CorpusChunk; score: number } | null = null;
  for (const entry of indexedCorpus) {
    if (!withinSizeRatio(candidateChars, entry.chunk.charCount)) {
      continue;
    }
    const score = jaccard(candidateShingles, entry.shingleSet);
    if (!best || score > best.score) {
      best = { chunk: entry.chunk, score };
    }
  }
  return best;
}

function withinSizeRatio(a: number, b: number): boolean {
  /* c8 ignore next 3 -- defensive: candidate and corpus chunks both clear the min-lines
     floor, so neither char count is ever 0 by the time this runs. */
  if (a === 0 || b === 0) {
    return a === b;
  }
  const ratio = a > b ? a / b : b / a;
  return ratio <= SIZE_RATIO_GUARD;
}

function enrichMatch(
  knowledge: CodeKnowledgeIndex | null,
  chunk: CorpusChunk,
  matchedRange: LineRange,
): { symbol?: string; callers: number } {
  if (!knowledge) {
    return { symbol: chunk.exportedSymbols[0], callers: 0 };
  }
  const inFile = knowledge.symbols.filter((symbol) => symbol.file === chunk.file);
  const inRange = inFile.filter(
    (symbol) => symbol.line >= matchedRange.start && symbol.line <= matchedRange.end,
  );
  const pool =
    inRange.length > 0 ? inRange : inFile.filter((s) => chunk.exportedSymbols.includes(s.name));
  if (pool.length === 0) {
    return { symbol: chunk.exportedSymbols[0], callers: 0 };
  }
  const top = pool.reduce((a, b) => (b.caller_count > a.caller_count ? b : a));
  return { symbol: top.name, callers: top.caller_count };
}

function nonWhitespaceLength(content: string): number {
  return content.replace(/\s/g, '').length;
}

function dedupeFindings(findings: DuplicationFinding[]): DuplicationFinding[] {
  const byKey = new Map<string, DuplicationFinding>();
  for (const finding of findings) {
    const key = `${finding.file}:${finding.line_range.start}:${finding.matched_file}`;
    const existing = byKey.get(key);
    if (!existing || finding.similarity > existing.similarity) {
      byKey.set(key, finding);
    }
  }
  return [...byKey.values()].sort(
    (a, b) => a.file.localeCompare(b.file) || a.line_range.start - b.line_range.start,
  );
}
