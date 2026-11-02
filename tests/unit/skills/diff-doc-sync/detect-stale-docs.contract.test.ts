import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/diff-doc-sync/scripts/detect-stale-docs.sh',
  names: [
    'detect-stale-docs help',
    'detect-stale-docs invalid input',
    'detect-stale-docs fixture output',
    'detect-stale-docs idempotency',
    'detect-stale-docs dry run',
    'detect-stale-docs output size',
    'detect-stale-docs secrets',
  ],
  fixture: {
    args: ['{dir}/modules'],
    stdin: 'src/users/handler.ts\n',
    files: {
      'modules/billing/README.md': '',
      'modules/users/README.md': '',
      'modules/users/api/endpoints.md': '',
    },
    stdout: '<dir>/modules/users/README.md\n<dir>/modules/users/api/endpoints.md\n',
  },
  invalid: { args: ['no-such-root'], exit: 0 },
});
