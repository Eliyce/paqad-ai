import { createHash } from 'node:crypto';

import type { ObligationCategory } from './types.js';

export interface MarkdownHeading {
  level: number;
  text: string;
  line: number;
}

export interface MarkdownSection {
  path: string;
  category: ObligationCategory;
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function splitLines(source: string): string[] {
  return source.replace(/\r\n/g, '\n').split('\n');
}

export function parseHeadings(lines: string[]): MarkdownHeading[] {
  const headings: MarkdownHeading[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const match = /^(#{1,6})\s+(.*\S)\s*$/.exec(line);
    if (!match) continue;

    headings.push({
      level: match[1]!.length,
      text: match[2]!,
      line: index + 1,
    });
  }

  return headings;
}

export function buildHeadingPath(headings: MarkdownHeading[], line: number): string {
  const stack: MarkdownHeading[] = [];

  for (const heading of headings) {
    if (heading.line > line) break;
    while (stack.length > 0 && stack[stack.length - 1]!.level >= heading.level) {
      stack.pop();
    }
    stack.push(heading);
  }

  return stack.map((heading) => heading.text).join(' > ');
}

export function classifySection(sectionPath: string): MarkdownSection {
  const normalized = sectionPath.toLowerCase();

  if (
    /(?:^|> )(?:\d+(?:\.\d+)*\.?\s*)?(?:acceptance criteria\b|definition of done\b|ac\b)/.test(
      normalized,
    )
  ) {
    return { path: sectionPath, category: 'acceptance' };
  }

  if (/(?:^|> )(?:\d+(?:\.\d+)*\.?\s*)?edge cases?\b|\bec-/.test(normalized)) {
    return { path: sectionPath, category: 'edge-case' };
  }

  if (
    /(?:^|> )(?:\d+(?:\.\d+)*\.?\s*)?non-functional(?: requirements?)?\b|\bnfr\b/.test(normalized)
  ) {
    return { path: sectionPath, category: 'non-functional' };
  }

  if (/(?:^|> )(?:\d+(?:\.\d+)*\.?\s*)?functional requirements\b|\bfr-/.test(normalized)) {
    return { path: sectionPath, category: 'functional' };
  }

  return { path: sectionPath, category: 'unclassified' };
}

export function makeDeterministicGeneratedId(sectionPath: string, index: number): string {
  const digest = sha256Hex(`${sectionPath}::${index}`);
  return `GEN-${digest.slice(0, 12).toUpperCase()}`;
}

export function normalizeCell(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}
