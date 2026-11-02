import { describeContract } from '../_helpers/contract.js';

describeContract({
  script:
    'runtime/capabilities/coding/skills/state-coverage-review/scripts/extract-source-states.sh',
  names: [
    'extract-source-states help',
    'extract-source-states invalid input',
    'extract-source-states fixture output',
    'extract-source-states idempotency',
    'extract-source-states dry run',
    'extract-source-states output size',
    'extract-source-states secrets',
  ],
  fixture: {
    args: ['{dir}/Empty.tsx'],
    files: { 'Empty.tsx': 'export const Empty = () => <div/>;' },
    stdout: 'default\timplicit\n',
  },
  invalid: { args: ['/no/such/file.tsx'], exit: 2 },
});
