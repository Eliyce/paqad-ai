import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/capabilities/content/skills/seo-optimizer/scripts/lint-output.sh',
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
    stdin: '## SEO Findings\n- Title is long.\n## Suggested Title/Meta\nTitle: Refunds\n',
    stdout: 'ok\n',
  },
  invalid: { args: ['missing.md'], exit: 2 },
});
