import type { Obligation, ObligationCategory, ObligationIndex, SpecReviewReport } from './types.js';
import {
  buildHeadingPath,
  classifySection,
  makeDeterministicGeneratedId,
  normalizeCell,
  parseHeadings,
  sha256Hex,
  splitLines,
} from './markdown.js';
import { COMPLIANCE_SCHEMA_VERSION } from './constants.js';
import { attachSpecDefectsToObligations } from './spec-review.js';

type TableRow = {
  cells: string[];
  line: number;
  header_cells: string[];
};

export interface ExtractObligationsOptions {
  spec_file: string;
  spec_markdown: string;
  extracted_at?: string;
  spec_review?: SpecReviewReport | null;
}

export function extractObligationIndex(options: ExtractObligationsOptions): ObligationIndex {
  const extractedAt = options.extracted_at ?? new Date().toISOString();
  const warnings: string[] = [];
  const lines = splitLines(options.spec_markdown);
  const headings = parseHeadings(lines);

  const obligations: Obligation[] = [];
  const seenIds = new Set<string>();

  const tables = extractRecognizedTables(lines);

  for (const row of tables.rows) {
    const sectionPath = buildHeadingPath(headings, row.line);
    const { category } = classifySection(sectionPath);
    const obligation = obligationFromTableRow(row, options.spec_file, sectionPath, category);
    if (!obligation) continue;

    if (seenIds.has(obligation.obligation_id)) {
      warnings.push(
        `Duplicate obligation_id "${obligation.obligation_id}" (table row at line ${row.line})`,
      );
      continue;
    }
    seenIds.add(obligation.obligation_id);
    obligations.push(obligation);
  }

  // Per-section counter ensures generated IDs are stable even when numbered list
  // items are added or removed in unrelated sections (Bug 7 / FR-2.6).
  const sectionItemCount = new Map<string, number>();

  for (const item of extractNumberedListItems(lines)) {
    const sectionPath = buildHeadingPath(headings, item.line);
    const { category } = classifySection(sectionPath);
    if (category !== 'acceptance' || !isAcceptanceListSection(sectionPath)) {
      continue;
    }
    const count = (sectionItemCount.get(sectionPath) ?? 0) + 1;
    sectionItemCount.set(sectionPath, count);
    const generatedId = makeDeterministicGeneratedId(sectionPath, count);

    if (seenIds.has(generatedId)) {
      continue;
    }

    obligations.push({
      obligation_id: generatedId,
      category,
      description: normalizeCell(item.text),
      pass_criteria: null,
      source_section: sectionPath,
      source_line: item.line,
      spec_file: options.spec_file,
      affected_by_spec_defects: [],
    });
    seenIds.add(generatedId);
  }

  for (const match of extractExplicitIds(lines, tables.table_lines)) {
    if (seenIds.has(match.id)) continue;

    const sectionPath = buildHeadingPath(headings, match.line);
    const { category } = classifySection(sectionPath);

    obligations.push({
      obligation_id: match.id,
      category,
      description: normalizeCell(match.text),
      pass_criteria: null,
      source_section: sectionPath,
      source_line: match.line,
      spec_file: options.spec_file,
      affected_by_spec_defects: [],
    });
    seenIds.add(match.id);
  }

  if (obligations.length === 0) {
    warnings.push('No recognizable structured obligations found in spec.');
  }

  obligations.sort((left, right) => left.obligation_id.localeCompare(right.obligation_id));
  const linkedReview = options.spec_review
    ? attachSpecDefectsToObligations(options.spec_review, obligations)
    : null;

  const obligationsWithDefects = obligations.map((obligation) => ({
    ...obligation,
    affected_by_spec_defects:
      linkedReview === null
        ? []
        : linkedReview.defects
            .filter((defect) => defect.affected_obligation_ids!.includes(obligation.obligation_id))
            .map((defect) => defect.defect_id)
            .sort((a, b) => a.localeCompare(b)),
  }));

  return {
    metadata: {
      spec_file: options.spec_file,
      spec_hash: sha256Hex(options.spec_markdown),
      extracted_at: extractedAt,
      obligation_count: obligations.length,
      schema_version: COMPLIANCE_SCHEMA_VERSION,
      warnings,
    },
    obligations: obligationsWithDefects,
  };
}

function obligationFromTableRow(
  row: TableRow,
  specFile: string,
  sectionPath: string,
  category: ObligationCategory,
): Obligation | null {
  if (row.cells.length < 2) return null;

  const normalizedCells = row.cells.map(normalizeCell);
  const headerCells = row.header_cells.map((cell) => cell.toLowerCase().trim());
  const [first, second, third, fourth] = normalizedCells;

  const obligationId = first || null;
  if (!obligationId) return null;

  const descriptionColumn = selectDescriptionColumn(headerCells, normalizedCells);
  const passCriteriaColumn = selectPassCriteriaColumn(headerCells, normalizedCells);

  const description = firstNonEmpty(descriptionColumn, second, third) ?? '';
  const passCriteria = firstNonEmpty(passCriteriaColumn, fourth);

  return {
    obligation_id: obligationId,
    category,
    description,
    pass_criteria: passCriteria,
    source_section: sectionPath,
    source_line: row.line,
    spec_file: specFile,
    affected_by_spec_defects: [],
  };
}

function extractRecognizedTables(lines: string[]): { rows: TableRow[]; table_lines: Set<number> } {
  const rows: TableRow[] = [];
  const tableLines = new Set<number>();

  for (let index = 0; index < lines.length; index += 1) {
    const headerLine = lines[index]!;
    if (!isTableRow(headerLine)) continue;

    const headerCells = parseTableRow(headerLine);
    const isRecognized = headerLooksLikeObligationTable(headerCells);
    if (!isRecognized) continue;

    const separatorLine = lines[index + 1];
    if (!separatorLine || !looksLikeTableSeparator(separatorLine)) continue;

    tableLines.add(index + 1);
    tableLines.add(index + 2);
    index += 2;

    while (index < lines.length) {
      const line = lines[index]!;
      if (!isTableRow(line)) break;
      const cells = parseTableRow(line);
      if (cells.every((cell) => cell.trim().length === 0)) {
        index += 1;
        continue;
      }
      rows.push({ cells, line: index + 1, header_cells: headerCells });
      tableLines.add(index + 1);
      index += 1;
    }

    index -= 1;
  }

  return { rows, table_lines: tableLines };
}

function headerLooksLikeObligationTable(cells: string[]): boolean {
  const normalized = cells.map((cell) => cell.toLowerCase().trim());
  const joined = normalized.join(' | ');

  const hasId = /test id|obligation|id|#/.test(joined);
  const hasConditionOrCriterion =
    /condition|scenario|criterion|requirement|case|description|method/.test(joined);
  const hasPass = /pass criteria|expected|assert|measurement|result|outcome/.test(joined);

  return hasId && hasConditionOrCriterion && hasPass;
}

function isTableRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('|') && trimmed.endsWith('|');
}

function looksLikeTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  return isTableRow(trimmed) && /^\|(?:\s*:?-+:?\s*\|)+$/.test(trimmed);
}

function parseTableRow(line: string): string[] {
  const inner = line.trim().slice(1, -1);
  return inner.split('|').map((cell) => cell.trim());
}

function extractNumberedListItems(
  lines: string[],
): Array<{ index: number; line: number; text: string }> {
  const items: Array<{ index: number; line: number; text: string }> = [];
  let currentIndex = 0;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]!;
    const match = /^\s*(\d+)\.\s+(.*\S)\s*$/.exec(line);
    if (!match) continue;
    currentIndex += 1;
    items.push({ index: currentIndex, line: lineIndex + 1, text: match[2]! });
  }

  return items;
}

function extractExplicitIds(
  lines: string[],
  excludedLines: Set<number>,
): Array<{ id: string; line: number; text: string }> {
  const matches: Array<{ id: string; line: number; text: string }> = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    if (excludedLines.has(lineIndex + 1)) continue;
    const line = lines[lineIndex]!;
    const id = extractLeadingExplicitId(line);
    if (!id) continue;
    matches.push({ id, line: lineIndex + 1, text: line });
  }

  return matches;
}

function isAcceptanceListSection(sectionPath: string): boolean {
  return /(?:^|> )(?:\d+(?:\.\d+)*\.?\s*)?(acceptance criteria|definition of done|ac)\b/i.test(
    sectionPath,
  );
}

function selectDescriptionColumn(headerCells: string[], rowCells: string[]): string | null {
  const descriptionIndex = headerCells.findIndex((cell) =>
    /condition|scenario|criterion|requirement|case|description|method/.test(cell),
  );
  if (descriptionIndex > 0) {
    return rowCells[descriptionIndex] || null;
  }
  return rowCells[1] || rowCells[2] || null;
}

function selectPassCriteriaColumn(headerCells: string[], rowCells: string[]): string | null {
  const passIndex = headerCells.findIndex((cell) =>
    /pass criteria|expected|assert|measurement|result|outcome/.test(cell),
  );
  if (passIndex > 0) {
    return rowCells[passIndex] || null;
  }
  return rowCells[2] || rowCells[3] || null;
}

function extractLeadingExplicitId(line: string): string | null {
  const match =
    /^\s*(?:#{1,6}\s+|[-*+]\s+)?(?:\*\*)?(?<id>(?:FR|NFR)-\d+(?:\.\d+)?(?:-T\d+)?|AC-(?:TRACK-[A-Za-z0-9-]+|\d+)|EC-\d+(?:-T\d+)?)(?:\*\*)?(?=\b|:|\s)/.exec(
      line,
    );
  if (match?.groups?.id) {
    return match.groups.id;
  }

  if (line.trim().startsWith('|')) {
    const rowMatch =
      /^\|\s*(?<id>(?:FR|NFR)-\d+(?:\.\d+)?(?:-T\d+)?|AC-\d+|EC-\d+(?:-T\d+)?)\s*\|/.exec(line);
    if (rowMatch?.groups?.id) {
      return rowMatch.groups.id;
    }
  }

  return null;
}

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (value && value.trim().length > 0) {
      return value;
    }
  }
  return null;
}
