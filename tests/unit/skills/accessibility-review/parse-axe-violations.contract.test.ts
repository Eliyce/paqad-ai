import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/capabilities/coding/skills/accessibility-review/scripts/parse-axe-violations.sh',
  names: [
    'parse-axe-violations help',
    'parse-axe-violations invalid input',
    'parse-axe-violations fixture output',
    'parse-axe-violations idempotency',
    'parse-axe-violations dry run',
    'parse-axe-violations output size',
    'parse-axe-violations secrets',
  ],
  fixture: {
    args: ['{dir}/a.json'],
    files: {
      'a.json':
        '[{"id":"image-alt","impact":"critical","help":"Images must have alt text","nodes":[{"target":["img.hero"]}]}]',
    },
    stdout: '(route-unknown)\timage-alt\tcritical\timg.hero\tImages must have alt text\n',
  },
  invalid: { args: ['/no/such/file.json'], exit: 2 },
});
