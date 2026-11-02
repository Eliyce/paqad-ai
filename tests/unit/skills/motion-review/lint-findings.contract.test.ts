import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/capabilities/coding/skills/motion-review/scripts/lint-findings.sh',
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
      '## Findings\n- **high** (motion.md → reduced-motion) — auth / motion: Toast ignores reduced-motion. Evidence: `src/Toast.tsx:42`. Required action: gate with `@media (prefers-reduced-motion: reduce)`.',
    stdout: 'ok\n',
  },
  invalid: {
    args: [],
    stdin:
      '## Findings\n- (motion.md → reduced-motion) — motion: bad. Evidence: `src/Toast.tsx:42`. Required action: fix.',
    exit: 1,
  },
});
