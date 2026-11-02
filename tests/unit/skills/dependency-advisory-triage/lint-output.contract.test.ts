import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/capabilities/security/skills/dependency-advisory-triage/scripts/lint-output.sh',
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
    stdin:
      '## Dependency Findings\n### npm:lodash: GHSA-1234\n- **Severity:** high\n- **Sources:** npm-audit.json\n- **Installed:** 4.17.10\n- **Remediation:** upgrade to 4.17.21\n',
    stdout: 'ok\n',
  },
  invalid: { args: ['missing.md'], exit: 2 },
});
