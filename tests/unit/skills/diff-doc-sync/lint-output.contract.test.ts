import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/diff-doc-sync/scripts/lint-output.sh',
  names: [
    'lint-output help',
    'lint-output invalid input',
    'lint-output fixture output',
    'lint-output idempotency',
    'lint-output dry run',
    'lint-output output size',
    'lint-output secrets',
  ],
  fixture: { args: [], stdin: '[]', stdout: 'ok\n' },
  invalid: { args: [], stdin: 'not json', exit: 1 },
});
