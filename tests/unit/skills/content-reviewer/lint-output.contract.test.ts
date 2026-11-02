import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/capabilities/content/skills/content-reviewer/scripts/lint-output.sh',
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
    stdin: '## Blocking Issues\n- The intro repeats the title.\nImprovement Opportunities: none\n',
    stdout: 'ok\n',
  },
  invalid: { args: ['missing.md'], exit: 2 },
});
