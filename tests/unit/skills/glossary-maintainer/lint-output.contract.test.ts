import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/glossary-maintainer/scripts/lint-output.sh',
  names: [
    'lint-output help',
    'lint-output invalid input',
    'lint-output fixture output',
    'lint-output idempotency',
    'lint-output dry run',
    'lint-output output size',
    'lint-output secrets',
  ],
  fixture: { args: [], stdin: 'Glossary Updates: none\n', stdout: 'ok\n' },
  invalid: { args: [], stdin: '## Terminology Drift\n- none\n', exit: 1 },
});
