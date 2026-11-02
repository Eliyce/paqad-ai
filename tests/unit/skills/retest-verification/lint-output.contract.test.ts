import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/capabilities/security/skills/retest-verification/scripts/lint-output.sh',
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
    args: ['retest.md', 'source.json'],
    files: {
      'retest.md': '## Retest Decisions\n### PT-1: fixed\n### PT-2: still-open\n',
      'source.json':
        '[{"id":"PT-1","title":"a","severity":"high"},{"id":"PT-2","title":"b","severity":"low"}]',
    },
    stdout: 'ok\n',
  },
  invalid: { args: ['retest.md'], exit: 2 },
});
