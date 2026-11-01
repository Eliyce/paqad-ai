import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/capabilities/security/skills/input-validation-review/scripts/lint-findings.sh',
  names: [
    'lint-findings help',
    'lint-findings invalid input',
    'lint-findings fixture output',
    'lint-findings idempotency',
    'lint-findings dry run',
    'lint-findings output size',
    'lint-findings secrets',
  ],
  fixture: {
    stdin: '## Findings\n- SQL built from input (WSTG-INPV-05). Evidence: src/db.js:9\n',
    stdout: 'ok\n',
  },
  invalid: { args: ['missing.md'], exit: 2 },
});
