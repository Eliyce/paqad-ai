import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/capabilities/coding/skills/ux-state-machine/scripts/lint-output.sh',
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
      '## State Inventory\n- **idle** — ready — initial\n## Transitions\n| From | Trigger | To | Notes |\n| --- | --- | --- | --- |\n| idle | click | loading | none |\n## Gaps\n- none',
    stdout: 'ok\n',
  },
  invalid: {
    args: [],
    stdin: '## Transitions\n| From | Trigger | To | Notes |\n## Gaps\nnone\n',
    exit: 1,
  },
});
