import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

type Step = {
  name?: string;
  id?: string;
  uses?: string;
  run?: string;
  if?: string;
  shell?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
};
type Job = {
  'runs-on': string;
  'timeout-minutes'?: number;
  environment?: unknown;
  env?: Record<string, string>;
  steps: Step[];
};
type Workflow = {
  on: Record<string, unknown>;
  permissions: unknown;
  concurrency: { group: string; 'cancel-in-progress': boolean };
  env?: Record<string, string>;
  jobs: Record<string, Job>;
};

const raw = readFileSync('.github/workflows/plugin-eval.yml', 'utf8');
const workflow = parse(raw) as Workflow;
const jobs = Object.values(workflow.jobs);
const job = jobs[0]!;
const index = (pattern: RegExp) => job.steps.findIndex((step) => pattern.test(step.name ?? ''));
const step = (pattern: RegExp) => job.steps[index(pattern)]!;
const suiteRun = (suite: string) => step(new RegExp(`^${suite} suite$`, 'i')).run ?? '';

describe('plugin-eval workflow', () => {
  it('runs only on dispatch and the weekly schedule', () => {
    expect(Object.keys(workflow.on).sort()).toEqual(['schedule', 'workflow_dispatch']);
    expect(workflow.on.workflow_dispatch).toBeNull();
    expect(workflow.on.schedule).toEqual([{ cron: expect.stringMatching(/^\S+ \S+ \* \* \d$/) }]);
  });

  it('reads only repository contents and never double-runs', () => {
    expect(workflow.permissions).toEqual({ contents: 'read' });
    expect(workflow.concurrency['cancel-in-progress']).toBe(false);
    expect(jobs).toHaveLength(1);
    expect(job['timeout-minutes']).toBeGreaterThan(0);
    expect(job.environment).toBeUndefined();
    expect(step(/^checkout$/i).with).toMatchObject({ 'persist-credentials': false });
  });

  it('fails first, naming the secret, when the API key is missing', () => {
    expect(index(/api key secret/i)).toBe(0);
    const check = job.steps[0]!;
    expect(check.env).toEqual({ ANTHROPIC_API_KEY: '${{ secrets.ANTHROPIC_API_KEY }}' });
    expect(check.run).toContain('[ -z "$ANTHROPIC_API_KEY" ]');
    expect(check.run).toContain('ANTHROPIC_API_KEY repository secret is not set');
    expect(check.run).toContain('exit 1');
  });

  it('pins every action to a full commit SHA and Claude Code to 2.1.302', () => {
    for (const { uses } of job.steps.filter((s) => s.uses)) {
      expect(uses).toMatch(/^actions\/[a-z-]+@[0-9a-f]{40}$/);
    }
    expect(step(/install claude code/i).run).toContain('@anthropic-ai/claude-code@2.1.302');
    expect(step(/install claude code/i).run).toContain('claude --version');
    expect(job.env?.DISABLE_AUTOUPDATER).toBe('1');
  });

  it('installs, builds and stages the plugin before any suite runs', () => {
    const order = [/install dependencies/i, /^build$/i, /stage the plugin/i, /routing suite/i];
    const at = order.map(index);
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(step(/install dependencies/i).run).toBe('pnpm install --frozen-lockfile');
    expect(step(/stage the plugin/i).run).toContain('node scripts/stage-plugin-eval.mjs "$STAGE"');
  });

  it('runs three suites in order, then the score check, then the upload', () => {
    const at = [
      /routing suite/i,
      /firewall suite/i,
      /receipt suite/i,
      /score check/i,
      /upload/i,
    ].map(index);
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    for (const suite of ['firewall', 'receipt']) {
      expect(step(new RegExp(`${suite} suite`, 'i')).if).toBe('${{ !cancelled() }}');
    }
    expect(step(/score check/i).if).toBe('${{ !cancelled() }}');
    expect(step(/upload/i).if).toBe('always()');
  });

  it.each([
    ['routing', null, '10'],
    ['firewall', '--allow-tools Edit Write --', '20'],
    ['receipt', '--allow-tools Edit Write Bash --', '20'],
  ])('runs the %s suite alone with its own grant and ceiling', (suite, grant, ceiling) => {
    const run = suiteRun(suite);
    expect(run).toContain(`claude plugin eval "$STAGE" --tag ${suite} `);
    for (const flag of [
      '--runs 3',
      '--scaffold',
      '--trust-plugin',
      '--no-publish',
      '--threshold 0',
    ]) {
      expect(run).toContain(flag);
    }
    expect(run).toContain(`--max-cost-usd ${ceiling}`);
    expect(run).toContain(`--json "$RESULTS/${suite}.json"`);
    expect(run).toContain(`--report "$RESULTS/${suite}.html"`);
    if (grant === null) {
      expect(run).not.toContain('--allow-tools');
    } else {
      expect(run).toContain(grant);
    }
    expect(step(new RegExp(`${suite} suite`, 'i')).env).toEqual({
      ANTHROPIC_API_KEY: '${{ secrets.ANTHROPIC_API_KEY }}',
    });
  });

  it('pins the receipt judge model', () => {
    expect(suiteRun('receipt')).toContain('--judge-model sonnet');
  });

  it('gates routing and firewall at 0.9 and only reports the receipt suite', () => {
    const score = step(/score check/i);
    expect(score.shell).toBe('bash');
    expect(score.run).toContain('node scripts/check-plugin-eval-score.mjs');
    expect(score.run).toContain('routing="$RESULTS/routing.json"');
    expect(score.run).toContain('firewall="$RESULTS/firewall.json"');
    expect(score.run).toContain('--report-only receipt="$RESULTS/receipt.json"');
    expect(score.run).toContain('--min 0.9');
    expect(score.run).toContain('tee -a "$GITHUB_STEP_SUMMARY"');
  });

  it('uploads each report and result by explicit path', () => {
    const paths = String(step(/upload/i).with?.path)
      .trim()
      .split('\n');
    expect(paths).toEqual(
      ['routing', 'firewall', 'receipt'].flatMap((suite) => [
        `evals/results/${suite}.json`,
        `evals/results/${suite}.html`,
      ]),
    );
  });

  it('keeps the secret to the steps that need it and writes no inputs into shell lines', () => {
    expect(raw).not.toContain('${{ inputs.');
    const withKey = job.steps.filter((s) => s.env?.ANTHROPIC_API_KEY).map((s) => s.name);
    expect(withKey).toEqual([
      'Check the API key secret',
      'Routing suite',
      'Firewall suite',
      'Receipt suite',
    ]);
    expect(job.env?.ANTHROPIC_API_KEY).toBeUndefined();
    expect(raw).not.toMatch(/echo[^\n]*\$ANTHROPIC_API_KEY/);
  });
});
