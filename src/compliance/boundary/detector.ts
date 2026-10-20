import type { BoundaryInterface, BoundaryRelationship } from './types.js';

const ANNOTATION_PATTERN =
  /\/\/\s*@boundary\s+([A-Za-z_]\w*)(?:\s+producer:([^\s]+))?(?:\s+consumer:([^\s]+))?(?:\s+states:([^\s]+))?/;

const ENUM_OPEN_PATTERN = /\benum\s+([A-Za-z_]\w*)\s*\{/;

const UNION_TYPE_PATTERN = /\btype\s+([A-Za-z_]\w*)\s*=\s*([^;]+);/;

export function detectBoundariesInSource(filePath: string, source: string): BoundaryInterface[] {
  const lines = source.split('\n');
  const boundaries: BoundaryInterface[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const annotationMatch = ANNOTATION_PATTERN.exec(line);
    if (!annotationMatch) continue;

    const typeName = annotationMatch[1]!;
    const producerSpec = annotationMatch[2] ?? null;
    const consumerSpecs = annotationMatch[3] ? annotationMatch[3].split(',') : [];
    const explicitStates = annotationMatch[4] ? annotationMatch[4].split(',') : null;

    const nextLine = findNextNonBlank(lines, i + 1);
    const states = explicitStates ?? extractStatesFromDefinition(lines, nextLine);

    const relationship = classifyRelationship(producerSpec, consumerSpecs, states);

    boundaries.push({
      type_name: typeName,
      file: filePath,
      producer_spec: producerSpec,
      consumer_specs: consumerSpecs,
      output_states: states,
      relationship,
    });
  }

  return boundaries;
}

function findNextNonBlank(lines: string[], from: number): number {
  for (let i = from; i < lines.length; i++) {
    if (lines[i]!.trim()) return i;
  }
  return from;
}

function extractStatesFromDefinition(lines: string[], lineIndex: number): string[] {
  const line = lines[lineIndex] ?? '';

  const enumMatch = ENUM_OPEN_PATTERN.exec(line);
  if (enumMatch) {
    return extractEnumMembers(lines, lineIndex);
  }

  const unionMatch = UNION_TYPE_PATTERN.exec(line);
  if (unionMatch) {
    return extractUnionMembers(unionMatch[2]!);
  }

  return [];
}

function extractEnumMembers(lines: string[], openLineIndex: number): string[] {
  const members: string[] = [];
  let body = '';
  let depth = 0;
  for (let i = openLineIndex; i < lines.length; i++) {
    const text = lines[i]!;
    for (const ch of text) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
    body += text + '\n';
    if (depth === 0 && i > openLineIndex) break;
  }

  const memberPattern = /\b([A-Za-z_]\w*)\s*(?:=|,|\n|})/g;
  for (const match of body.matchAll(memberPattern)) {
    const name = match[1]!;
    if (name === 'enum' || name === 'const' || name === 'export') continue;
    members.push(name);
  }
  return [...new Set(members)];
}

function extractUnionMembers(rhs: string): string[] {
  const members: string[] = [];
  for (const rawPart of rhs.split('|')) {
    const part = rawPart.trim();
    if (!part) continue;

    const quoted = part.match(/^(['"`])(.+)\1$/);
    if (quoted) {
      members.push(quoted[2]!.trim());
      continue;
    }

    const identifier = part.match(/^([A-Za-z_]\w*)$/);
    if (identifier) {
      members.push(identifier[1]!);
    }
  }
  return [...new Set(members)];
}

function classifyRelationship(
  producer: string | null,
  consumers: string[],
  states: string[],
): BoundaryRelationship {
  if (states.length === 0) return 'unanalyzable';
  if (!producer && consumers.length === 0) return 'shared_utility';
  if (producer && consumers.length > 0) return 'producer_consumer';
  return 'shared_utility';
}
