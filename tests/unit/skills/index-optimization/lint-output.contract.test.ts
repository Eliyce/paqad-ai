import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/capabilities/coding/skills/index-optimization/scripts/lint-output.sh',
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
    stdin: 'Correctness Risks: none\nMigration Safety Risks: none\nPerformance Risks: none\n',
    stdout: 'ok\n',
  },
  invalid: { args: [], stdin: 'Correctness Risks: none\n', exit: 1 },
});
