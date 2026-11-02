import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/edge-case-detection/scripts/lint-output.sh',
  names: [
    'lint-output help',
    'lint-output invalid input',
    'lint-output fixture output',
    'lint-output idempotency',
    'lint-output dry run',
    'lint-output output size',
    'lint-output secrets',
  ],
  fixture: { args: [], stdin: 'No Additional Edge Cases\n', stdout: 'ok\n' },
  invalid: { args: ['/no/such/file'], exit: 2 },
});
