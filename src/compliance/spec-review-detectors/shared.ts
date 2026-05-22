import type { ReviewLine } from './types.js';

export function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[`*_]/g, '').replace(/\s+/g, ' ').trim();
}

export function makeLocation(line: ReviewLine) {
  return {
    section: line.section,
    line_range: [line.line, line.line] as [number, number],
    text_excerpt: line.text.trim(),
  };
}
