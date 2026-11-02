import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/test-execution-feedback-loop/scripts/lint-output.sh',
  names: [
    'lint-output help',
    'lint-output invalid input',
    'lint-output fixture output',
    'lint-output idempotency',
    'lint-output dry run',
    'lint-output output size',
    'lint-output secrets',
  ],
  fixture: { args: [], stdin: 'Fix Proposals: none, verification passed.\n', stdout: 'ok\n' },
  invalid: {
    args: [],
    stdin:
      '## Fix Proposals\n### Failure 1\n- **AC:** AC-1.1\n- **Failure category:** test-failure\n- **Anchor:** `a:1`\n- **Root cause hypothesis:** x\n- **Proposed fix:** y\n- **Confidence:** high\n',
    exit: 1,
  },
});
