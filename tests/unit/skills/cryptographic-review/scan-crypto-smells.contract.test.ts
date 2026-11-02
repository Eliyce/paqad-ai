import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/capabilities/security/skills/cryptographic-review/scripts/scan-crypto-smells.sh',
  names: [
    'scan-crypto-smells help',
    'scan-crypto-smells invalid input',
    'scan-crypto-smells fixture output',
    'scan-crypto-smells idempotency',
    'scan-crypto-smells dry run',
    'scan-crypto-smells output size',
    'scan-crypto-smells secrets',
  ],
  fixture: {
    args: ['src'],
    files: { 'src/token.js': 'const id = Math.random();\n' },
    stdout:
      'smell | file:line | excerpt\ninsecure-prng-js | src/token.js:1 | const id = Math.random();\n',
  },
  invalid: { args: ['no-such-root'], exit: 0 },
});
