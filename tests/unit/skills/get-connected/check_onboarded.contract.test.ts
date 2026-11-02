import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/claude-plugin/skills/get-connected/scripts/check_onboarded.py',
  names: [
    'check_onboarded help',
    'check_onboarded invalid input',
    'check_onboarded fixture output',
    'check_onboarded idempotency',
    'check_onboarded dry run',
    'check_onboarded output size',
    'check_onboarded secrets',
  ],
  fixture: {
    args: ['--root', '.'],
    files: {
      'docs/instructions/registries/modules.md':
        '# Modules\n\n| Slug | Name | Docs | Features |\n| --- | --- | --- | --- |\n| billing | Billing and refunds | [x](../../modules/billing/index/summary.md) | refunds, invoices, payments |\n| catalog | Product catalogue | [x](../../modules/catalog/index/summary.md) | products, prices |\n',
      'docs/modules/billing/index/summary.md': 'Billing charges shoppers and issues refunds.\n',
      'docs/modules/catalog/index/summary.md': '',
      'docs/modules/catalog/notes.md': 'x\n',
    },
    stdout: '{"ok": true, "state": "ready", "unknown_areas": ["catalog"]}\n',
  },
  invalid: { args: ['--root', '.'], exit: 1 },
});
