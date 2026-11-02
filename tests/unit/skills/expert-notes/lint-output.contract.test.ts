import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/expert-notes/scripts/lint-output.sh',
  names: [
    'lint-output help',
    'lint-output invalid input',
    'lint-output fixture output',
    'lint-output idempotency',
    'lint-output dry run',
    'lint-output output size',
    'lint-output secrets',
  ],
  fixture: {
    args: ['notes.json'],
    files: {
      'notes.json': JSON.stringify({
        notes: [
          {
            role: 'qa-engineer',
            findings: [
              {
                target: 'invoices',
                claim: 'a void invoice keeps its number',
                kind: 'invariant',
                severity: 'must',
              },
            ],
            questions: [],
            verdicts: {
              spec_compliance: { status: 'pass', reason: 'every AC is covered' },
              quality: { status: 'concerns', reason: 'one flaky test' },
            },
          },
        ],
      }),
    },
    stdout: 'ok\n',
  },
  invalid: { args: ['/no/such/notes.json'], exit: 2 },
});
