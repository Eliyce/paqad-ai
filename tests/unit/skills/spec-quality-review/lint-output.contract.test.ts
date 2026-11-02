import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/spec-quality-review/scripts/lint-output.sh',
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
      '## Findings\n- High (vague-quantifier) — spec.md:42: ambiguous. Required clarification: pick a number.\n',
    stdout: 'ok\n',
  },
  invalid: { args: [], stdin: 'no header here\n', exit: 1 },
});
