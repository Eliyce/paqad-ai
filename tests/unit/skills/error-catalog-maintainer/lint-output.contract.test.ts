import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/error-catalog-maintainer/scripts/lint-output.sh',
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
    args: [],
    stdin:
      '## Updated Error Entries\n- `USER_NOT_FOUND` in `docs/modules/users/error-codes.md`\n## Catalog Gaps\n- none\n',
    stdout: 'ok\n',
  },
  invalid: { args: [], stdin: '## Catalog Gaps\nnone\n', exit: 1 },
});
