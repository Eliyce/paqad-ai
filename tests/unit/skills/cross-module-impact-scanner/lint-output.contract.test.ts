import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/cross-module-impact-scanner/scripts/lint-output.sh',
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
    args: ['report.md'],
    files: {
      'report.md': [
        '## Cross-Module Impact',
        '### Impact Map',
        '| Surface | Type | Consumer | Severity | Coordinated change |',
        '|---|---|---|---|---|',
        '| GET /orders | api | billing | additive | none |',
        '',
      ].join('\n'),
    },
    stdout: 'ok\n',
  },
  invalid: { args: ['missing.md'], exit: 2 },
});
