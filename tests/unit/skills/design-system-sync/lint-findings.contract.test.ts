import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/capabilities/coding/skills/design-system-sync/scripts/lint-findings.sh',
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
      '## Findings\n- **medium** (tokens.md → color.brand) — auth / documentation-drift: brand token used in code but undeclared. Evidence: `tailwind.config.ts:12`. Required action: append `color.brand = #abcdef` to tokens.md.',
    stdout: 'ok\n',
  },
  invalid: { args: [], stdin: '## Findings\n- nope', exit: 1 },
});
