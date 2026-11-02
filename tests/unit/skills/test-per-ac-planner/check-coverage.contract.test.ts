import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/test-per-ac-planner/scripts/check-coverage.sh',
  names: [
    'check-coverage help',
    'check-coverage invalid input',
    'check-coverage fixture output',
    'check-coverage idempotency',
    'check-coverage dry run',
    'check-coverage output size',
    'check-coverage secrets',
  ],
  fixture: {
    args: ['{dir}/ac.md', '{dir}/plan.md'],
    files: { 'ac.md': '### AC-1.1\n### AC-1.2\n### AC-2.1\n', 'plan.md': '### AC-1.1 → T1.1\n' },
    stdout: 'AC-1.2\nAC-2.1\n',
  },
  invalid: { args: [], exit: 2 },
});
