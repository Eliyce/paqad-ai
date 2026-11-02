import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/performance-regression-estimator/scripts/lint-output.sh',
  names: [
    'lint-output help',
    'lint-output invalid input',
    'lint-output fixture output',
    'lint-output idempotency',
    'lint-output dry run',
    'lint-output output size',
    'lint-output secrets',
  ],
  fixture: { args: [], stdin: 'Performance Hazards: none detected.\n', stdout: 'ok\n' },
  invalid: {
    args: [],
    stdin:
      '## Performance Hazards\n### Hazard Map\n| # | Hazard | Severity |\n### Recommended Pre-Merge Actions\n',
    exit: 1,
  },
});
