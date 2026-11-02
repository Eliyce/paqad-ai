import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/rollback-safety-planner/scripts/select-stories.sh',
  names: [
    'select-stories help',
    'select-stories invalid input',
    'select-stories fixture output',
    'select-stories idempotency',
    'select-stories dry run',
    'select-stories output size',
    'select-stories secrets',
  ],
  fixture: {
    args: ['{dir}/plan.md'],
    files: {
      'plan.md':
        '### S-3 — wide\nblast-radius: wide\n### S-1 — hard\nreversibility: hard\n### S-2 — wide\nblast-radius: wide',
    },
    stdout: 'S-1\nS-2\nS-3\n',
  },
  invalid: { args: ['/no/such/plan.md'], exit: 1 },
});
