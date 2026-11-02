import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/capabilities/coding/skills/user-flow-generation/scripts/lint-output.sh',
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
    stdin: '## Primary Flow\n1. step\n## Alternate Paths\nFlow Gaps: none',
    stdout: 'ok\n',
  },
  invalid: { args: [], stdin: '## Alternate Paths\n## Flow Gaps\n- none\n', exit: 1 },
});
