import { parseReport as parseCobertura } from './cobertura.js';
import type { ParsedReport } from './types.js';

export function parseReport(content: string): ParsedReport {
  return parseCobertura(content);
}
