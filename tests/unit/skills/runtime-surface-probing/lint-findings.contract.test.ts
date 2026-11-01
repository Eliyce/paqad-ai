import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/capabilities/security/skills/runtime-surface-probing/scripts/lint-findings.sh',
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
    stdin: '## Findings\n- Debug page exposed. Path: `/debug` Status: 200\n',
    stdout: 'ok\n',
  },
  invalid: { args: ['missing.md'], exit: 2 },
});
