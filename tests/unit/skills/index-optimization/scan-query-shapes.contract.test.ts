import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/capabilities/coding/skills/index-optimization/scripts/scan-query-shapes.sh',
  names: [
    'scan-query-shapes help',
    'scan-query-shapes invalid input',
    'scan-query-shapes fixture output',
    'scan-query-shapes idempotency',
    'scan-query-shapes dry run',
    'scan-query-shapes output size',
    'scan-query-shapes secrets',
  ],
  fixture: {
    args: ['{dir}/q.sql'],
    files: {
      'q.sql':
        "SELECT * FROM users WHERE id IN (1,2,3);\nSELECT * FROM users WHERE email LIKE '%@x%';",
    },
    stdout:
      "shape | file:line | excerpt\nin-or-like-filter | <dir>/q.sql:1 | SELECT * FROM users WHERE id IN (1,2,3);\nin-or-like-filter | <dir>/q.sql:2 | SELECT * FROM users WHERE email LIKE '%@x%';\n",
  },
  invalid: { args: [], exit: 2 },
});
