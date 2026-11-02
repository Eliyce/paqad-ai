import { describeContract } from '../_helpers/contract.js';

describeContract({
  script:
    'runtime/capabilities/security/skills/business-logic-abuse-review/scripts/find-workflow-docs.sh',
  names: [
    'find-workflow-docs help',
    'find-workflow-docs invalid input',
    'find-workflow-docs fixture output',
    'find-workflow-docs idempotency',
    'find-workflow-docs dry run',
    'find-workflow-docs output size',
    'find-workflow-docs secrets',
  ],
  fixture: {
    args: ['docs/modules'],
    files: {
      'docs/modules/orders/workflow.md': '# Order workflow\nStates: draft, paid, refunded.\n',
      'docs/modules/orders/notes.md': 'plain notes\n',
    },
    stdout: 'docs/modules/orders/workflow.md\n',
  },
  invalid: { args: ['no-such-root'], exit: 0 },
});
