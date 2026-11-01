import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/spec-quality-review/scripts/scan-defects.sh',
  names: [
    'scan-defects help',
    'scan-defects invalid input',
    'scan-defects fixture output',
    'scan-defects idempotency',
    'scan-defects dry run',
    'scan-defects output size',
    'scan-defects secrets',
  ],
  fixture: {
    args: ['{dir}/spec.md'],
    files: { 'spec.md': 'It should be fast. However, accuracy is more important.\n' },
    stdout:
      'category | line | excerpt\nmissing-actor | 1 | It should be fast. However, accuracy is more important.\ngoal-collision | 1 | It should be fast. However, accuracy is more important.\n',
  },
  invalid: { args: ['/no/such/spec.md'], exit: 1 },
});
