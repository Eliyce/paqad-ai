import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/capabilities/coding/skills/motion-review/scripts/scan-animations.sh',
  names: [
    'scan-animations help',
    'scan-animations invalid input',
    'scan-animations fixture output',
    'scan-animations idempotency',
    'scan-animations dry run',
    'scan-animations output size',
    'scan-animations secrets',
  ],
  fixture: {
    args: ['{dir}/src'],
    files: {
      'src/A.css': '.x { transition: all 300ms ease; }',
      'src/B.css': '.y { transition-duration: 0.5s; }',
      'src/C.tsx': '<motion.div transition={{ duration: 0.3 }} />',
      'src/Slow.css': '.z { animation: slide 800ms linear; }',
    },
    stdout:
      '<dir>/src/C.tsx:1\t300\t<motion.div transition={{ duration: 0.3 }} />\n<dir>/src/B.css:1\t500\t.y { transition-duration: 0.5s; }\n<dir>/src/A.css:1\t300\t.x { transition: all 300ms ease; }\n<dir>/src/Slow.css:1\t800\t.z { animation: slide 800ms linear; }\n',
  },
  invalid: { args: ['no-such-root'], exit: 0 },
});
