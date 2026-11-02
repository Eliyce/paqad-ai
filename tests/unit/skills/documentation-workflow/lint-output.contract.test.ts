import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/documentation-workflow/scripts/lint-output.sh',
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
      '## Workflow Status\nMode: foundation\n## Completed Stages\n- s1\n## Blocked Stages\nnone\n',
    stdout: 'ok\n',
  },
  invalid: { args: [], stdin: '## Workflow Status\n## Blocked Stages\n', exit: 1 },
});
