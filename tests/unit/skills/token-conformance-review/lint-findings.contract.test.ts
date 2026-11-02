import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/capabilities/coding/skills/token-conformance-review/scripts/lint-findings.sh',
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
      '## Findings\n\n- **high** (tokens.md → color.primary.500) — auth / token: hard-coded `#1a73e8`. Evidence: `src/Button.tsx:42`. Required action: replace with `color.primary.500`.',
    stdout: 'ok\n',
  },
  invalid: {
    args: [],
    stdin:
      '## Findings\n- **high** (tokens.md → color.primary.500) — token: hard-coded. Required action: replace.',
    exit: 1,
  },
});
