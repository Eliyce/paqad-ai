import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/capabilities/coding/skills/root-cause-analysis/scripts/lint-output.sh',
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
      '## Problem Statement\nx\n## Symptoms & Impact\n- y\n## Timeline\n- 12:00 — z\n## Evidence\n- log.txt:1\n## Root Cause\ncause\n## Contributing Factors\n- factor\n## Solution\nfix\n## Verification & Follow-Up\n- check',
    stdout: 'ok\n',
  },
  invalid: { args: [], stdin: '## Problem Statement\n## Solution\n', exit: 1 },
});
