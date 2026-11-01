import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/scope-check/scripts/check-spec-presence.sh',
  names: [
    'check-spec-presence help',
    'check-spec-presence invalid input',
    'check-spec-presence fixture output',
    'check-spec-presence idempotency',
    'check-spec-presence dry run',
    'check-spec-presence output size',
    'check-spec-presence secrets',
  ],
  fixture: {
    args: ['{dir}'],
    files: { 'billing.md': '# spec', 'users.md': '# spec' },
    stdout: '<dir>/billing.md\n<dir>/users.md\n',
  },
  invalid: { args: ['{dir}'], exit: 1 },
});
