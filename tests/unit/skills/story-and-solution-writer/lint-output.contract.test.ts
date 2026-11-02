import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/story-and-solution-writer/scripts/lint-output.sh',
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
      '## Story\nx\n## Constraints\n- y\n## Proposed Solution\n1. z\n## Verification Notes\n- w\n',
    stdout: 'ok\n',
  },
  invalid: { args: ['/no/such/file'], exit: 2 },
});
