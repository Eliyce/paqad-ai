import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { Obligation } from '../types.js';

export interface GenerateVitestSkeletonOptions {
  project_root: string;
  /** Obligations to scaffold. Pass only uncovered/partial to respect FR-5.5, or all for --all mode. */
  obligations: Obligation[];
  output_dir: string;
}

export async function generateVitestSkeletons(
  options: GenerateVitestSkeletonOptions,
): Promise<string[]> {
  const outDir = path.resolve(options.project_root, options.output_dir);
  await mkdir(outDir, { recursive: true });

  const written: string[] = [];

  for (const obligation of options.obligations) {
    const fileName = `${sanitize(obligation.obligation_id)}.test.ts`;
    const filePath = path.join(outDir, fileName);

    // FR-5.4: idempotent — do not overwrite an existing file (developer may have
    // partially implemented the test).
    const exists = await fileExists(filePath);
    if (!exists) {
      const contents = renderVitestSkeleton(obligation);
      await writeFile(filePath, contents, 'utf8');
    }

    written.push(filePath);
  }

  written.sort((left, right) => left.localeCompare(right));
  return written;
}

/**
 * Renders a failing Vitest test stub for a single obligation (FR-5.2).
 *
 * The generated file:
 * - Uses the obligation ID in the test name.
 * - Includes a comment block with obligation_id, description, pass_criteria, and source_section.
 * - Contains an inline `@obligation` annotation so compliance-checker can detect coverage.
 * - Fails when executed (explicit assertion that is always false).
 */
export function renderVitestSkeleton(obligation: Obligation): string {
  const desc =
    obligation.description.trim().length > 0
      ? obligation.description.trim()
      : `Obligation ${obligation.obligation_id}`;

  const passCriteria = obligation.pass_criteria?.trim() ?? 'N/A';
  const sourceLocation =
    obligation.source_line !== null
      ? `${obligation.source_section} (line ${obligation.source_line})`
      : obligation.source_section;

  const testName = `${obligation.obligation_id}: ${desc}`;

  return `import { describe, it, expect } from 'vitest';

describe('Spec compliance obligation', () => {
  /**
   * @obligation ${obligation.obligation_id}
   * Description:    ${desc}
   * Pass criteria:  ${passCriteria}
   * Source:         ${sourceLocation}
   */
  it(${JSON.stringify(testName)}, () => {
    // @obligation ${obligation.obligation_id}
    expect(false, 'TODO: implement test for this obligation').toBe(true);
  });
});
`;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function sanitize(obligationId: string): string {
  return obligationId.replace(/[^a-zA-Z0-9._-]+/g, '-');
}
