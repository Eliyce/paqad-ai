import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/claude-plugin/skills/ground-in-project/scripts/find_related.py',
  names: [
    'find_related help',
    'find_related invalid input',
    'find_related fixture output',
    'find_related idempotency',
    'find_related dry run',
    'find_related output size',
    'find_related secrets',
  ],
  fixture: {
    args: ['--registry', 'modules.md', '--query', 'refund a paid order'],
    files: {
      'modules.md':
        '# Modules\n\n| Slug | Name | Docs | Features |\n| --- | --- | --- | --- |\n| billing | Billing and refunds | [x](../../modules/billing/index/summary.md) | refunds, invoices, payments |\n| catalog | Product catalogue | [x](../../modules/catalog/index/summary.md) | products, prices |\n',
    },
    stdout:
      '[{"module": "billing", "plain_name": "Billing and refunds", "score": 1, "matched_terms": ["refund"]}]\n',
  },
  invalid: { args: ['--registry', 'missing.md', '--query', 'refund'], exit: 1 },
});
