import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/finding-normalizer/scripts/validate-findings.sh',
  names: [
    'validate-findings help',
    'validate-findings invalid input',
    'validate-findings fixture output',
    'validate-findings idempotency',
    'validate-findings dry run',
    'validate-findings output size',
    'validate-findings secrets',
  ],
  fixture: {
    args: [],
    stdin:
      '[{"id":"PT-open","title":"a","severity":"low","effort":"trivial","impact_area":"x","evidence":"y","reproduction":"z","status":"open"}]',
    stdout: 'ok\n',
  },
  invalid: { args: [], stdin: '{}', exit: 1 },
});
