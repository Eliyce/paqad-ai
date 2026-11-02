import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/api-doc-maintainer/scripts/find-api-docs.sh',
  names: [
    'find-api-docs help',
    'find-api-docs invalid input',
    'find-api-docs fixture output',
    'find-api-docs idempotency',
    'find-api-docs dry run',
    'find-api-docs output size',
    'find-api-docs secrets',
  ],
  fixture: {
    args: ['{dir}/modules'],
    files: {
      'modules/billing/api/endpoints.md': '# billing',
      'modules/billing/api/error-codes.md': '# errors',
      'modules/users/README.md': 'unrelated',
      'modules/users/api/endpoints.md': '# users',
      'modules/users/api/openapi.yml': 'unrelated',
      'modules/users/api/schemas.md': '# schemas',
    },
    stdout:
      '<dir>/modules/billing/api/endpoints.md\n<dir>/modules/billing/api/error-codes.md\n<dir>/modules/users/api/endpoints.md\n<dir>/modules/users/api/schemas.md\n',
  },
  invalid: { args: ['no-such-root'], exit: 0 },
});
