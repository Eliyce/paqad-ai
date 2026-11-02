import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/glossary-maintainer/scripts/find-term-uses.sh',
  names: [
    'find-term-uses help',
    'find-term-uses invalid input',
    'find-term-uses fixture output',
    'find-term-uses idempotency',
    'find-term-uses dry run',
    'find-term-uses output size',
    'find-term-uses secrets',
  ],
  fixture: {
    args: ['refund window'],
    files: {
      'docs/modules/billing/api/endpoints.md':
        'POST /invoices/{id}/refund — applies the refund window logic\nGET /invoices — listing\n',
    },
    stdout:
      'doc-file\tdocs/modules/billing/api/endpoints.md\napi-endpoint\tPOST /invoices/{id}/refund\n',
  },
  invalid: { args: [], exit: 2 },
});
