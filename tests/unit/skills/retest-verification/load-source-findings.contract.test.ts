import { describeContract } from '../_helpers/contract.js';

describeContract({
  script:
    'runtime/capabilities/security/skills/retest-verification/scripts/load-source-findings.sh',
  names: [
    'load-source-findings help',
    'load-source-findings invalid input',
    'load-source-findings fixture output',
    'load-source-findings idempotency',
    'load-source-findings dry run',
    'load-source-findings output size',
    'load-source-findings secrets',
  ],
  fixture: {
    args: ['source.json'],
    files: {
      'source.json':
        '[{"id":"PT-1","title":"Open redirect","severity":"medium","evidence":"src/r.js:2"}]',
    },
    stdout:
      '{"id":"PT-1","title":"Open redirect","severity":"medium","status":"open","evidence":"src/r.js:2"}\n',
  },
  invalid: { args: ['missing.json'], exit: 2 },
});
