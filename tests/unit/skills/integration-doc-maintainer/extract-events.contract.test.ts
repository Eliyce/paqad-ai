import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/integration-doc-maintainer/scripts/extract-events.sh',
  names: [
    'extract-events help',
    'extract-events invalid input',
    'extract-events fixture output',
    'extract-events idempotency',
    'extract-events dry run',
    'extract-events output size',
    'extract-events secrets',
  ],
  fixture: {
    args: ['{dir}/a.ts'],
    files: {
      'a.ts':
        'emit("user.created", payload);\neventBus.publish("order.refunded", { id });\nqueue.dispatch("invite.invited", inv);',
    },
    stdout: 'invite.invited\norder.refunded\nuser.created\n',
  },
  invalid: { args: [], exit: 2 },
});
