import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/capabilities/coding/skills/copy-and-ia-review/scripts/lint-findings.sh',
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
      '## Findings\n- **medium** (patterns.md → terminology) — auth / copy: User vs Member mismatch. Evidence: `src/Settings.tsx:42`. Required action: standardize on Member.',
    stdout: 'ok\n',
  },
  invalid: { args: [], stdin: '- nope', exit: 1 },
});
