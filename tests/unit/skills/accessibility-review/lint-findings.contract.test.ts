import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/capabilities/coding/skills/accessibility-review/scripts/lint-findings.sh',
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
      '## Findings\n- **blocker** (WCAG-2.2-1.4.3) — auth / a11y: contrast 3.8:1. Evidence: `src/Button.tsx:34`. Required action: darken `color.text.muted`.',
    stdout: 'ok\n',
  },
  invalid: {
    args: [],
    stdin:
      '## Findings\n- **high** — a11y: bad. Evidence: `src/Button.tsx:34`. Required action: fix.',
    exit: 1,
  },
});
