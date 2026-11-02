import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/context-budget-planner/scripts/estimate-tokens.sh',
  names: [
    'estimate-tokens help',
    'estimate-tokens invalid input',
    'estimate-tokens fixture output',
    'estimate-tokens idempotency',
    'estimate-tokens dry run',
    'estimate-tokens output size',
    'estimate-tokens secrets',
  ],
  fixture: {
    args: ['--available', '100000', '--committed', '30000'],
    stdin: '1.0 /tmp/paqad-skill-test-paQRy6/big.md\n',
    stdout:
      '## Context Budget\n\nSummary: Tier: green | Estimate: 0 tokens | Available: 70000 tokens | Headroom: 70000 tokens\n\n### Per-Artifact Estimate\n\n| Artifact | Lines | Weight | Tokens |\n| --- | --- | --- | --- |\n| `/tmp/paqad-skill-test-paQRy6/big.md` | 0 | 1.0 | 0 |\n\n### Recommended Compactions\n\nRecommended Compactions: none\n',
  },
  invalid: { args: ['--bogus', '1'], exit: 2 },
});
