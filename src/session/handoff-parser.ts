import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ParsedHandoff, StructuredHandoff, UnsupportedStructuredHandoff } from './types.js';

export class UnsupportedStructuredHandoffVersionError extends Error {
  constructor(readonly handoff: UnsupportedStructuredHandoff) {
    super(`Unsupported structured handoff version: ${handoff.version}`);
    this.name = 'UnsupportedStructuredHandoffVersionError';
  }
}

function isStructuredHandoff(data: unknown): data is StructuredHandoff {
  return typeof data === 'object' && data !== null && (data as { version?: unknown }).version === 2;
}

export class HandoffParser {
  async parse(projectRoot: string): Promise<ParsedHandoff | null> {
    // Try structured JSON first
    try {
      const jsonPath = join(projectRoot, '.paqad', 'session', 'handoff.json');
      const raw = await readFile(jsonPath, 'utf8');
      const data = JSON.parse(raw) as StructuredHandoff | UnsupportedStructuredHandoff;
      if (isStructuredHandoff(data)) {
        return { version: 2, data };
      }

      throw new UnsupportedStructuredHandoffVersionError({
        version: data.version,
        data,
      });
    } catch (error) {
      if (error instanceof UnsupportedStructuredHandoffVersionError) {
        throw error;
      }

      // fall through
    }

    // Try legacy markdown
    try {
      const mdPath = join(projectRoot, '.paqad', 'session', 'handoff.md');
      const raw = await readFile(mdPath, 'utf8');
      return { version: 1, data: raw };
    } catch {
      return null;
    }
  }

  isStructured(handoff: ParsedHandoff): handoff is { version: 2; data: StructuredHandoff } {
    return handoff.version === 2;
  }
}
