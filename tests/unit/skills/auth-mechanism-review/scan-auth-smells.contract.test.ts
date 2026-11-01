import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/capabilities/security/skills/auth-mechanism-review/scripts/scan-auth-smells.sh',
  names: [
    'scan-auth-smells help',
    'scan-auth-smells invalid input',
    'scan-auth-smells fixture output',
    'scan-auth-smells idempotency',
    'scan-auth-smells dry run',
    'scan-auth-smells output size',
    'scan-auth-smells secrets',
  ],
  fixture: {
    args: ['src'],
    files: { 'src/auth.js': "localStorage.setItem('token', t);\nconst ok = true;\n" },
    stdout:
      "smell | file:line | excerpt\ntoken-in-localstorage | src/auth.js:1 | localStorage.setItem('token', t);\n",
  },
  invalid: { args: ['no-such-root'], exit: 0 },
});
