import { describeContract } from '../_helpers/contract.js';

describeContract({
  script:
    'runtime/capabilities/security/skills/business-logic-abuse-review/scripts/lint-findings.sh',
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
    stdin:
      '## Findings\n### Refund twice\n- **Module:** orders\n- **Step:** refund\n- **Abuse case:** refund the same order twice\n- **Missing proof:** no idempotency key\n- **Reproduction:** call refund twice\n',
    stdout: 'ok\n',
  },
  invalid: { args: ['missing.md'], exit: 2 },
});
