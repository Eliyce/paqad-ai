import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/api-doc-maintainer/scripts/lint-output.sh',
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
      '## Updated API Docs\n- `docs/modules/users/api/endpoints.md` — added invite\n## Coverage Gaps\n- none',
    stdout: 'ok\n',
  },
  invalid: { args: ['/no/such/file.md'], exit: 2 },
});
