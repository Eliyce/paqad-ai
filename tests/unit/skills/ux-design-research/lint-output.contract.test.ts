import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/capabilities/coding/skills/ux-design-research/scripts/lint-output.sh',
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
    stdin: '## Research Targets\n- x\n## Reference Findings\n- y\n## Recommended Directions\n- z\n',
    stdout: 'ok\n',
  },
  invalid: { args: [], stdin: '## Research Targets\n## Reference Findings\n', exit: 1 },
});
