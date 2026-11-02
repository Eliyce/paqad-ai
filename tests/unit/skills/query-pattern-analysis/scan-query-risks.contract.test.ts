import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/capabilities/coding/skills/query-pattern-analysis/scripts/scan-query-risks.sh',
  names: [
    'scan-query-risks help',
    'scan-query-risks invalid input',
    'scan-query-risks fixture output',
    'scan-query-risks idempotency',
    'scan-query-risks dry run',
    'scan-query-risks output size',
    'scan-query-risks secrets',
  ],
  fixture: {
    args: ['{dir}/q.sql'],
    files: { 'q.sql': "SELECT * FROM users WHERE email LIKE '%@example%';" },
    stdout:
      "risk | file:line | excerpt\nover-fetching-select-star | <dir>/q.sql:1 | SELECT * FROM users WHERE email LIKE '%@example%';\nleading-wildcard-like | <dir>/q.sql:1 | SELECT * FROM users WHERE email LIKE '%@example%';\n",
  },
  invalid: { args: [], exit: 2 },
});
