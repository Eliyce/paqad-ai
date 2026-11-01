import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/capabilities/content/skills/content-writer/scripts/check-coverage.sh',
  names: [
    'check-coverage help',
    'check-coverage invalid input',
    'check-coverage fixture output',
    'check-coverage idempotency',
    'check-coverage dry run',
    'check-coverage output size',
    'check-coverage secrets',
  ],
  fixture: {
    args: ['brief.md', 'draft.md'],
    files: {
      'brief.md': '## Outline\n1. Why refunds: the reason\n2. How to ask: the steps\n## Other\n',
      'draft.md': '# Refunds\n## Why refunds\ntext\n## How to ask\ntext\n',
    },
    stdout: 'ok\n',
  },
  invalid: { args: ['missing.md'], exit: 2 },
});
