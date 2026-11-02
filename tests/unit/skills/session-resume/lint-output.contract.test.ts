import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/session-resume/scripts/lint-output.sh',
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
    stdin: '## Session State\n- x\n## Project Context\n- y\n## Resume Targets\n- z\n',
    stdout: 'ok\n',
  },
  invalid: { args: [], stdin: '## Project Context\n## Resume Targets\n', exit: 1 },
});
