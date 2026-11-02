import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/capabilities/coding/skills/responsive-review/scripts/find-horizontal-scroll.sh',
  names: [
    'find-horizontal-scroll help',
    'find-horizontal-scroll invalid input',
    'find-horizontal-scroll fixture output',
    'find-horizontal-scroll idempotency',
    'find-horizontal-scroll dry run',
    'find-horizontal-scroll output size',
    'find-horizontal-scroll secrets',
  ],
  fixture: {
    args: ['{dir}/rc.json'],
    files: {
      'rc.json': '{"routes":[{"path":"/","breakpoints":[{"name":"lg","horizontalScroll":false}]}]}',
    },
    stdout: '',
  },
  invalid: { args: [], exit: 2 },
});
