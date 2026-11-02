import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/capabilities/coding/skills/motion-review/scripts/parse-motion-budget.sh',
  names: [
    'parse-motion-budget help',
    'parse-motion-budget invalid input',
    'parse-motion-budget fixture output',
    'parse-motion-budget idempotency',
    'parse-motion-budget dry run',
    'parse-motion-budget output size',
    'parse-motion-budget secrets',
  ],
  fixture: {
    args: ['{dir}/m.md'],
    files: {
      'm.md':
        '# Motion\n\nSome prose.\n\n- duration-ceiling: 200ms\n- something-else: ignored\n- easing: standard',
    },
    stdout: 'duration-ceiling\t200ms\neasing\tstandard\n',
  },
  invalid: { args: [], exit: 2 },
});
