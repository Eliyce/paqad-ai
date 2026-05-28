// coverage.py XML report parser. The schema is the cobertura clone produced
// by `coverage xml`: <class filename="…"> blocks containing <line hits="N"/>
// entries. We delegate to the cobertura parser to keep the line-counting
// logic in one place.

import { parseReport as parseCobertura } from './cobertura.js';
import type { ParsedReport } from './types.js';

export function parseReport(content: string): ParsedReport {
  return parseCobertura(content);
}
