import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/acceptance-criteria-gen/scripts/lint-ac-output.sh',
  names: [
    'lint-ac-output help',
    'lint-ac-output invalid input',
    'lint-ac-output fixture output',
    'lint-ac-output idempotency',
    'lint-ac-output dry run',
    'lint-ac-output output size',
    'lint-ac-output secrets',
  ],
  fixture: {
    args: [],
    stdin:
      '## Acceptance criteria\n\n- AC-1: Given an admin, when they invite, then a 201 is returned (proof: automated).\n- AC-2: Given a member, when they invite, then a 403 is returned (proof: manual).\n\n## Coverage Notes\n\n- AC-2 covers the permission edge.',
    stdout: 'ok\n',
  },
  invalid: { args: ['/no/such/file.md'], exit: 2 },
});
