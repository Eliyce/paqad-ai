import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/error-catalog-maintainer/scripts/extract-error-codes.sh',
  names: [
    'extract-error-codes help',
    'extract-error-codes invalid input',
    'extract-error-codes fixture output',
    'extract-error-codes idempotency',
    'extract-error-codes dry run',
    'extract-error-codes output size',
    'extract-error-codes secrets',
  ],
  fixture: {
    args: ['{dir}/a.ts'],
    files: {
      'a.ts':
        'throw new Error(USER_NOT_FOUND);\nthrow new Error(INVITE_FAILED);\nthrow new Error(EMAIL_INVALID);\nthrow new Error(EMAIL_MISSING);\nthrow new Error(SOMETHING_FORBIDDEN);\nthrow new Error(STATE_CONFLICT);\nthrow new Error(GENERIC_ERROR);',
    },
    stdout:
      'EMAIL_INVALID\nEMAIL_MISSING\nGENERIC_ERROR\nINVITE_FAILED\nSOMETHING_FORBIDDEN\nSTATE_CONFLICT\nUSER_NOT_FOUND\n',
  },
  invalid: { args: [], exit: 2 },
});
