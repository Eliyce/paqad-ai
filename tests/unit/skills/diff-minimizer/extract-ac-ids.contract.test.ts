import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/diff-minimizer/scripts/extract-ac-ids.sh',
  names: [
    'extract-ac-ids help',
    'extract-ac-ids invalid input',
    'extract-ac-ids fixture output',
    'extract-ac-ids idempotency',
    'extract-ac-ids dry run',
    'extract-ac-ids output size',
    'extract-ac-ids secrets',
  ],
  fixture: {
    args: ['{dir}/ac.md'],
    files: { 'ac.md': '### AC-2.1\nx\n### AC-1.1\ny\n### AC-1.2\nz\n' },
    stdout: 'AC-1.1\nAC-1.2\nAC-2.1\n',
  },
  invalid: { args: [], exit: 2 },
});
