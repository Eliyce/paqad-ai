import { describeContract } from '../_helpers/contract.js';

describeContract({
  script:
    'runtime/capabilities/coding/skills/component-conformance-review/scripts/lint-findings.sh',
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
      '## Findings\n- **high** (components.md → Button) — auth / component: variant `ghost` declared but not implemented. Evidence: `src/Button.tsx:1`. Required action: add `variant: ghost`.',
    stdout: 'ok\n',
  },
  invalid: {
    args: [],
    stdin: '## Findings\n- **high** — component: bad. Required action: fix.',
    exit: 1,
  },
});
