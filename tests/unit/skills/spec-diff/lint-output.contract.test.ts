import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/spec-diff/scripts/lint-output.sh',
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
      '## Spec Diff Decision\ncovered — reason\n## Evidence\n- `x.md` — y\n## Implication\n- z\n',
    stdout: 'ok\n',
  },
  invalid: { args: [], stdin: '## Evidence\n## Implication\n', exit: 1 },
});
