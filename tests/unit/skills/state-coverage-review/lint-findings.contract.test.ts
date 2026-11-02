import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/capabilities/coding/skills/state-coverage-review/scripts/lint-findings.sh',
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
    stdin:
      '## Findings\n- **high** (components.md → Button > focus) — auth / state: focus state not implemented. Evidence: `src/Button.tsx:1`. Required action: add focus-visible ring.',
    stdout: 'ok\n',
  },
  invalid: { args: [], stdin: '- nope', exit: 1 },
});
