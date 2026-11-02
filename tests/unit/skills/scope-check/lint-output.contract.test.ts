import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/scope-check/scripts/lint-output.sh',
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
      '## Scope Decision\nwithin-scope — reason\n## Spec Evidence\n- `x.md` — y\n## Required Next Step\n- z',
    stdout: 'ok\n',
  },
  invalid: { args: [], stdin: '## Spec Evidence\n## Required Next Step\n', exit: 1 },
});
