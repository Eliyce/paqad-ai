import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/capabilities/coding/skills/responsive-review/scripts/lint-findings.sh',
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
      '## Findings\n- **high** (responsive.md → breakpoint:sm) — auth / responsive: horizontal scroll at 640px. Evidence: `src/Pricing.tsx:18`. Required action: wrap cards below sm.',
    stdout: 'ok\n',
  },
  invalid: { args: [], stdin: '## Findings\n', exit: 1 },
});
