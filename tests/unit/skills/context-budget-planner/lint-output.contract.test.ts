import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/context-budget-planner/scripts/lint-output.sh',
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
    stdin:
      '## Context Budget\n\nSummary: Tier: green | Estimate: 300 tokens | Available: 170000 tokens | Headroom: 169700 tokens\n\n### Per-Artifact Estimate\n\n| Artifact | Lines | Weight | Tokens |\n| --- | --- | --- | --- |\n| `a.md` | 100 | 3.0 | 300 |\n\n### Recommended Compactions\n\nRecommended Compactions: none',
    stdout: 'ok\n',
  },
  invalid: {
    args: [],
    stdin:
      '## Context Budget\nSummary: Tier: green Estimate 0 Available 0\n### Per-Artifact Estimate\n### Recommended Compactions\n',
    exit: 1,
  },
});
