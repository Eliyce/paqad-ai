import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/error-catalog-maintainer/scripts/find-error-catalogs.sh',
  names: [
    'find-error-catalogs help',
    'find-error-catalogs invalid input',
    'find-error-catalogs fixture output',
    'find-error-catalogs idempotency',
    'find-error-catalogs dry run',
    'find-error-catalogs output size',
    'find-error-catalogs secrets',
  ],
  fixture: {
    args: ['{dir}/modules'],
    files: {
      'modules/billing/api/error-codes.md': '',
      'modules/billing/error-codes.md': '',
      'modules/users/README.md': 'unrelated',
      'modules/users/error-catalog.md': '',
    },
    stdout:
      '<dir>/modules/billing/api/error-codes.md\n<dir>/modules/billing/error-codes.md\n<dir>/modules/users/error-catalog.md\n',
  },
  invalid: { args: ['no-such-root'], exit: 0 },
});
