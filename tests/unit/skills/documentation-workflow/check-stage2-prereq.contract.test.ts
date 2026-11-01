import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/documentation-workflow/scripts/check-stage2-prereq.sh',
  names: [
    'check-stage2-prereq help',
    'check-stage2-prereq invalid input',
    'check-stage2-prereq fixture output',
    'check-stage2-prereq idempotency',
    'check-stage2-prereq dry run',
    'check-stage2-prereq output size',
    'check-stage2-prereq secrets',
  ],
  fixture: {
    args: [],
    files: { 'docs/instructions/rules/module-map.yml': 'users:\n' },
    stdout: 'ok\n',
  },
  invalid: { args: [], exit: 1 },
});
