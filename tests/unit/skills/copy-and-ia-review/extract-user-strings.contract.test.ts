import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/capabilities/coding/skills/copy-and-ia-review/scripts/extract-user-strings.sh',
  names: [
    'extract-user-strings help',
    'extract-user-strings invalid input',
    'extract-user-strings fixture output',
    'extract-user-strings idempotency',
    'extract-user-strings dry run',
    'extract-user-strings output size',
    'extract-user-strings secrets',
  ],
  fixture: {
    args: ['{dir}/src'],
    files: {
      'src/A.tsx': '<button aria-label="Open menu" />',
      'src/B.tsx': '<input placeholder="Search products" />',
      'src/C.tsx': '<a href="/" title="Home page">x</a>',
      'src/D.tsx': '<h1>Welcome to Paqad</h1>',
    },
    stdout:
      'aria-label\t<dir>/src/A.tsx:1\tOpen menu\nplaceholder\t<dir>/src/B.tsx:1\tSearch products\ntitle\t<dir>/src/C.tsx:1\tHome page\njsx-text\t<dir>/src/D.tsx:1\tWelcome to Paqad\n',
  },
  invalid: { args: ['no-such-root'], exit: 0 },
});
