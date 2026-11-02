import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/adversarial-review/scripts/lint-findings.sh',
  names: [
    'lint-findings help',
    'lint-findings invalid input',
    'lint-findings fixture output',
    'lint-findings idempotency',
    'lint-findings dry run',
    'lint-findings output size',
    'lint-findings secrets',
  ],
  fixture: {
    args: [],
    stdin: '## Findings\n- **Low** — x. Required action: fix.\n',
    stdout: 'ok\n',
  },
  invalid: { args: [], stdin: '## Findings\n\n## Open Questions\n- none\n', exit: 1 },
});
