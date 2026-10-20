import type { RenderedDelivery } from './templates.js';

export interface DeliveryShell {
  run(
    command: string,
    args: string[],
  ): Promise<{ stdout: string; stderr: string; exitCode: number }>;
}

export interface DeliveryRunInputs {
  rendered: RenderedDelivery;
  base: string;
  draft: boolean;
  reviewers: string[];
  labels: string[];
  open_pr: 'yes' | 'draft' | 'no';
}

export interface DeliveryStepResult {
  step: 'branch' | 'commit' | 'push' | 'pr';
  ok: boolean;
  remediation?: string;
  output?: string;
}

export interface DeliveryRunResult {
  steps: DeliveryStepResult[];
  ok: boolean;
}

export async function runDelivery(
  shell: DeliveryShell,
  inputs: DeliveryRunInputs,
): Promise<DeliveryRunResult> {
  const steps: DeliveryStepResult[] = [];

  const branchResult = await shell.run('git', ['checkout', '-b', inputs.rendered.branch]);
  steps.push({
    step: 'branch',
    ok: branchResult.exitCode === 0,
    output: branchResult.stderr || branchResult.stdout,
    remediation:
      branchResult.exitCode === 0
        ? undefined
        : `Failed to create branch ${inputs.rendered.branch}. Resolve the conflicting state and re-run delivery.`,
  });
  if (branchResult.exitCode !== 0) {
    return { steps, ok: false };
  }

  const commitResult = await shell.run('git', ['commit', '-m', inputs.rendered.commit]);
  steps.push({
    step: 'commit',
    ok: commitResult.exitCode === 0,
    output: commitResult.stderr || commitResult.stdout,
    remediation:
      commitResult.exitCode === 0
        ? undefined
        : 'git commit failed. Stage changes (git add) and re-run delivery; do not skip pre-commit hooks.',
  });
  if (commitResult.exitCode !== 0) {
    return { steps, ok: false };
  }

  if (inputs.open_pr === 'no') {
    return { steps, ok: true };
  }

  const pushResult = await shell.run('git', [
    'push',
    '--set-upstream',
    'origin',
    inputs.rendered.branch,
  ]);
  steps.push({
    step: 'push',
    ok: pushResult.exitCode === 0,
    output: pushResult.stderr || pushResult.stdout,
    remediation:
      pushResult.exitCode === 0
        ? undefined
        : `git push failed. Check remote auth and branch protection before retrying.`,
  });
  if (pushResult.exitCode !== 0) {
    return { steps, ok: false };
  }

  const prArgs = [
    'pr',
    'create',
    '--base',
    inputs.base,
    '--head',
    inputs.rendered.branch,
    '--title',
    inputs.rendered.pr_title,
    '--body',
    inputs.rendered.pr_body,
  ];
  if (inputs.open_pr === 'draft') {
    prArgs.push('--draft');
  }
  for (const reviewer of inputs.reviewers) {
    prArgs.push('--reviewer', reviewer);
  }
  for (const label of inputs.labels) {
    prArgs.push('--label', label);
  }
  const prResult = await shell.run('gh', prArgs);
  steps.push({
    step: 'pr',
    ok: prResult.exitCode === 0,
    output: prResult.stderr || prResult.stdout,
    remediation:
      prResult.exitCode === 0
        ? undefined
        : 'gh pr create failed. Ensure `gh auth status` is OK and the branch was pushed cleanly, then re-run delivery.',
  });

  return { steps, ok: prResult.exitCode === 0 };
}
