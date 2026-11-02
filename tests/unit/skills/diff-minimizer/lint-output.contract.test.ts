import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/diff-minimizer/scripts/lint-output.sh',
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
      '## Diff Minimization\n### Step Map\n| # | Step | Classification | Mapped AC | Action |\n| --- | --- | --- | --- | --- |\n| 1 | x | over-build | — | y |\n### Recommended Drops\n### Necessary Setup\nOpen Questions: none',
    stdout: 'ok\n',
  },
  invalid: {
    args: [],
    stdin:
      '## Diff Minimization\n### Step Map\n| # | Step |\n### Recommended Drops\n### Necessary Setup\nOpen Questions: none\n',
    exit: 1,
  },
});
