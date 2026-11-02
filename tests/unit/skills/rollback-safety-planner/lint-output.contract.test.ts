import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/rollback-safety-planner/scripts/lint-output.sh',
  names: [
    'lint-output help',
    'lint-output invalid input',
    'lint-output fixture output',
    'lint-output idempotency',
    'lint-output dry run',
    'lint-output output size',
    'lint-output secrets',
  ],
  fixture: {
    args: [],
    stdin:
      'Rollback Plans: none required (all stories have easy reversibility and isolated blast radius).\n',
    stdout: 'ok\n',
  },
  invalid: {
    args: [],
    stdin:
      '## Rollback Plans\n### S-1\n- **Trigger:** x\n- **Time-to-rollback:** y\n- **Steps:** z\n- **Verification:** w\n- **Drill:** v\n',
    exit: 1,
  },
});
