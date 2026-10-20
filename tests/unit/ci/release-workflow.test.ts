import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

type Step = {
  name?: string;
  id?: string;
  uses?: string;
  run?: string;
  if?: string;
  env?: Record<string, string>;
};
type Job = {
  needs?: string | string[];
  if?: string;
  outputs?: Record<string, string>;
  permissions?: Record<string, string>;
  steps: Step[];
};

const workflow = parse(readFileSync('.github/workflows/release.yml', 'utf8')) as {
  jobs: Record<string, Job>;
};
const release = workflow.jobs.release!;
const publish = workflow.jobs['publish-plugin']!;
const tokenStep = publish.steps.find((step) => step.id === 'token')!;

function runTokenCheck(token: string): { stdout: string; output: string } {
  const dir = mkdtempSync(join(tmpdir(), 'paqad-release-step-'));
  const outputFile = join(dir, 'output');
  try {
    const stdout = execFileSync('bash', ['-c', tokenStep.run!], {
      env: { PATH: process.env.PATH, GITHUB_OUTPUT: outputFile, PAQAD_PLUGIN_PUSH_TOKEN: token },
      encoding: 'utf8',
    });
    return { stdout, output: readFileSync(outputFile, 'utf8') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('the release workflow publishes the plugin', () => {
  it('runs publish-plugin only after a published release', () => {
    expect(release.outputs?.published).toBe('${{ steps.changesets.outputs.published }}');
    expect(publish.needs).toBe('release');
    expect(publish.if).toBe("needs.release.outputs.published == 'true'");
    expect(publish.permissions).toEqual({ contents: 'read' });
  });

  it.skipIf(process.platform === 'win32')(
    'prints the not-set notice and exits 0 when PAQAD_PLUGIN_PUSH_TOKEN is empty',
    () => {
      const empty = runTokenCheck('');
      expect(empty.stdout).toContain(
        '::notice::PAQAD_PLUGIN_PUSH_TOKEN is not set; skipping the plugin publish',
      );
      expect(empty.output).toBe('present=false\n');
      const set = runTokenCheck('a-token');
      expect(set.stdout).toBe('');
      expect(set.output).toBe('present=true\n');
    },
  );

  it('gates every later step on the token and reads the token only from the secret', () => {
    const later = publish.steps.slice(publish.steps.indexOf(tokenStep) + 1);
    expect(later.length).toBeGreaterThan(0);
    for (const step of later) expect(step.if).toBe("steps.token.outputs.present == 'true'");
    for (const step of publish.steps) {
      expect(step.run ?? '').not.toContain('secrets.');
      expect(step.run ?? '').not.toMatch(/echo[^\n]*\$\{?PAQAD_PLUGIN_PUSH_TOKEN/);
      if (step.env?.PAQAD_PLUGIN_PUSH_TOKEN !== undefined) {
        expect(step.env.PAQAD_PLUGIN_PUSH_TOKEN).toBe('${{ secrets.PAQAD_PLUGIN_PUSH_TOKEN }}');
      }
    }
  });

  it('assembles the tree with the script and pushes it and a version tag to Eliyce/paqad-plugin', () => {
    const push = publish.steps.at(-1)!.run!;
    expect(push).toContain('node scripts/assemble-plugin.mjs plugin-repo');
    expect(push).toContain('github.com/Eliyce/paqad-plugin.git');
    expect(push).toContain('git tag "v${VERSION}"');
    expect(push).toContain('git push --quiet origin "refs/tags/v${VERSION}"');
  });
});
