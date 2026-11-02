import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/capabilities/coding/skills/ux-heuristic-evaluation/scripts/lint-output.sh',
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
    stdin: 'Blocking Issues: none\nImprovement Opportunities: none\n',
    stdout: 'ok\n',
  },
  invalid: { args: [], stdin: '## Blocking Issues\n- x\n', exit: 1 },
});
