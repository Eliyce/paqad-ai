import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/capabilities/coding/skills/ui-doc-maintainer/scripts/lint-output.sh',
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
      '## Updated UI Docs\n- `docs/modules/users/ui/screens.md` — added invite\n## Open UI Gaps\n- none\n',
    stdout: 'ok\n',
  },
  invalid: { args: [], stdin: '## Open UI Gaps\nnone\n', exit: 1 },
});
