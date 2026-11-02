import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/acceptance-criteria-gen/scripts/next-ac-id.sh',
  names: [
    'next-ac-id help',
    'next-ac-id invalid input',
    'next-ac-id fixture output',
    'next-ac-id idempotency',
    'next-ac-id dry run',
    'next-ac-id output size',
    'next-ac-id secrets',
  ],
  fixture: {
    args: ['{dir}/spec.md'],
    files: { 'spec.md': '# spec\nno ACs yet\n' },
    stdout: 'AC-1\n',
  },
  invalid: { args: [], exit: 2 },
});
