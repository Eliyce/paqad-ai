import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/cross-module-impact-scanner/scripts/find-integration-docs.sh',
  names: [
    'find-integration-docs help',
    'find-integration-docs invalid input',
    'find-integration-docs fixture output',
    'find-integration-docs idempotency',
    'find-integration-docs dry run',
    'find-integration-docs output size',
    'find-integration-docs secrets',
  ],
  fixture: {
    args: ['{dir}/modules'],
    files: {
      'modules/billing/contracts.md': '',
      'modules/notify/integrations.md': '',
      'modules/orders/integration.md': '',
      'modules/users/api/endpoints.md': 'should not match',
      'modules/users/events.md': '',
    },
    stdout:
      '<dir>/modules/billing/contracts.md\n<dir>/modules/notify/integrations.md\n<dir>/modules/orders/integration.md\n<dir>/modules/users/events.md\n',
  },
  invalid: { args: ['no-such-root'], exit: 0 },
});
