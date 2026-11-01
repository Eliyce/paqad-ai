import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/canonical-doc-sync/scripts/lint-output.sh',
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
    stdin: '## Updated Docs\n- `docs/modules/x/README.md` — added\n## Known Drift\nnone\n',
    stdout: 'ok\n',
  },
  invalid: { args: [], stdin: '## Known Drift\nnone\n', exit: 1 },
});
