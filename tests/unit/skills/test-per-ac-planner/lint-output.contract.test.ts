import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/test-per-ac-planner/scripts/lint-output.sh',
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
      '## Verification Plan\n### AC-1.1 → T1.1, T1.2\n| Test ID | Layer | File | Case | Notes |\n| --- | --- | --- | --- | --- |\n| T1.1 | unit | tests/x.ts | happy | name "AC-1.1 — y" |\n| T1.2 | unit | tests/x.ts | dup | name "AC-1.1 — dup" |\n## Uncovered Criteria\n- AC-2.1: needs staging',
    stdout: 'ok\n',
  },
  invalid: { args: [], stdin: '### AC-1.1\n', exit: 1 },
});
