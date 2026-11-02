import { describeContract } from '../_helpers/contract.js';

describeContract({
  script:
    'runtime/capabilities/coding/skills/state-coverage-review/scripts/extract-tested-states.sh',
  names: [
    'extract-tested-states help',
    'extract-tested-states invalid input',
    'extract-tested-states fixture output',
    'extract-tested-states idempotency',
    'extract-tested-states dry run',
    'extract-tested-states output size',
    'extract-tested-states secrets',
  ],
  fixture: { args: ['--component', 'Button', '--tests', '/no/such/dir'], stdout: '' },
  invalid: { args: [], exit: 2 },
});
