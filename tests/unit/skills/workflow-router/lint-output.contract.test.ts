import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/workflow-router/scripts/lint-output.sh',
  names: [
    'lint-output help',
    'lint-output invalid input',
    'lint-output fixture output',
    'lint-output idempotency',
    'lint-output dry run',
    'lint-output output size',
    'lint-output secrets',
  ],
  fixture: { args: [], stdin: 'workflow: none\nreason: no routing rule matched\n', stdout: 'ok\n' },
  invalid: { args: [], stdin: 'workflow: bug-fix\nreason: x\n', exit: 1 },
});
