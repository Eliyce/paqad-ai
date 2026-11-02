import { describeContract } from '../_helpers/contract.js';

describeContract({
  script:
    'runtime/capabilities/security/skills/logging-monitoring-review/scripts/scan-log-smells.sh',
  names: [
    'scan-log-smells help',
    'scan-log-smells invalid input',
    'scan-log-smells fixture output',
    'scan-log-smells idempotency',
    'scan-log-smells dry run',
    'scan-log-smells output size',
    'scan-log-smells secrets',
  ],
  fixture: {
    args: ['src'],
    files: { 'src/login.js': "logger.info('login failed', password);\n" },
    stdout:
      "smell | file:line | excerpt\nsensitive-data-in-log | src/login.js:1 | logger.info('login failed', password);\n",
  },
  invalid: { args: ['no-such-root'], exit: 0 },
});
