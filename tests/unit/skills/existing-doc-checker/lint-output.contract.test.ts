import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/existing-doc-checker/scripts/lint-output.sh',
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
      '## Canonical Files\n- `docs/x.md`\n## Potential Drift\n- none\n## Missing Docs\n- none\n',
    stdout: 'ok\n',
  },
  invalid: { args: [], stdin: '## Potential Drift\n## Missing Docs\n', exit: 1 },
});
