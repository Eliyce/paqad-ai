import { readFile } from 'node:fs/promises';

import fg from 'fast-glob';
import { describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';

/**
 * Regression guard for the workflow-policy file location.
 *
 * The workflow policy files (`feature-development.yaml`, `delivery-policy.yaml`)
 * are authored, project-customizable contract and live under
 * `docs/instructions/workflows/` (the canonical `PATHS.WORKFLOWS_DIR`). They are
 * NOT the same thing as `.paqad/workflows/` (`PATHS.WORKFLOW_RUNS_DIR`), which
 * holds per-run execution records.
 *
 * Several comments and docs drifted to call the policy file
 * `.paqad/workflows/feature-development.yaml` — pointing readers (and agents) at
 * the run-records directory instead of the contract. This guard fails the build
 * if any source, doc, or runtime asset references a workflow *policy* YAML under
 * `.paqad/workflows/`, so the stale path can never silently come back.
 */
describe('workflow-policy path references', () => {
  // Matches a `.yaml`/`.yml` policy file under `.paqad/workflows/`, e.g.
  // `.paqad/workflows/feature-development.yaml`. Deliberately requires a file
  // segment so the legitimate runs-dir reference (`.paqad/workflows` with no
  // trailing file) does NOT match.
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
