import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/capabilities/content/skills/content-planner/scripts/lint-brief.sh',
  names: [
    'lint-brief help',
    'lint-brief invalid input',
    'lint-brief fixture output',
    'lint-brief idempotency',
    'lint-brief dry run',
    'lint-brief output size',
    'lint-brief secrets',
  ],
  fixture: {
    args: ['brief.md'],
    files: {
      'brief.md':
        'Audience: store owners\nGoal: explain refunds\nConstraints: 800 words\n## Outline\n1. Intro: why\nDependencies: none\nSuccess metric: fewer refund tickets\n',
    },
    stdout: 'ok\n',
  },
  invalid: { args: ['missing.md'], exit: 2 },
});
