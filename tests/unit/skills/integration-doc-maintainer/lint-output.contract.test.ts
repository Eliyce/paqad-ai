import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/integration-doc-maintainer/scripts/lint-output.sh',
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
      '## Updated Integration Docs\n- `docs/modules/x/events.md` — y\nConsistency Warnings: none\n',
    stdout: 'ok\n',
  },
  invalid: { args: [], stdin: 'Consistency Warnings: none\n', exit: 1 },
});
