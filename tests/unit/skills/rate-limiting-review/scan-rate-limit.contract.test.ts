import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/capabilities/security/skills/rate-limiting-review/scripts/scan-rate-limit.sh',
  names: [
    'scan-rate-limit help',
    'scan-rate-limit invalid input',
    'scan-rate-limit fixture output',
    'scan-rate-limit idempotency',
    'scan-rate-limit dry run',
    'scan-rate-limit output size',
    'scan-rate-limit secrets',
  ],
  fixture: {
    args: ['src'],
    files: { 'src/routes.js': "app.post('/login', handler);\n" },
    stdout:
      "signal | file:line | excerpt\nauth-endpoint | src/routes.js:1 | app.post('/login', handler);\n",
  },
  invalid: { args: ['no-such-root'], exit: 0 },
});
