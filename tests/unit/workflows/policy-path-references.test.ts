import { readFile } from 'node:fs/promises';

import fg from 'fast-glob';
import { describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';

describe('workflow-policy path references', () => {
  const STALE_POLICY_REF = /\.paqad\/workflows\/[A-Za-z0-9_-]+\.ya?ml/;

  it('keeps the canonical constants distinct (policy dir vs runs dir)', () => {
    expect(PATHS.WORKFLOWS_DIR).toBe('docs/instructions/workflows');
    expect(PATHS.WORKFLOW_RUNS_DIR).toBe('.paqad/workflows');
    expect(PATHS.WORKFLOWS_DIR).not.toBe(PATHS.WORKFLOW_RUNS_DIR);
  });

  it('no source/doc/runtime file points a workflow-policy YAML at .paqad/workflows/', async () => {
    const files = (
      await fg(['src/**/*.{ts,md}', 'docs/**/*.{md,yaml,yml}', 'runtime/**/*.{ts,md,sh,mjs}'], {
        cwd: process.cwd(),
        absolute: true,
        dot: false,
      })
    ).sort();
    expect(files.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of files) {
      const lines = (await readFile(file, 'utf8')).split('\n');
      lines.forEach((line, index) => {
        if (STALE_POLICY_REF.test(line)) {
          offenders.push(`${file}:${index + 1}: ${line.trim()}`);
        }
      });
    }

    expect(
      offenders,
      `Workflow-policy files live under '${PATHS.WORKFLOWS_DIR}', not ` +
        `'${PATHS.WORKFLOW_RUNS_DIR}' (that is the run-records dir). ` +
        `Fix these references:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});
