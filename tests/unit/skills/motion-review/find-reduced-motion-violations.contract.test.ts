import { describeContract } from '../_helpers/contract.js';

describeContract({
  script:
    'runtime/capabilities/coding/skills/motion-review/scripts/find-reduced-motion-violations.sh',
  names: [
    'find-reduced-motion-violations help',
    'find-reduced-motion-violations invalid input',
    'find-reduced-motion-violations fixture output',
    'find-reduced-motion-violations idempotency',
    'find-reduced-motion-violations dry run',
    'find-reduced-motion-violations output size',
    'find-reduced-motion-violations secrets',
  ],
  fixture: {
    args: ['{dir}/src'],
    files: {
      'src/Bad.css': '.x { transition: all 300ms ease; }',
      'src/Toast.tsx':
        "import { motion } from 'framer-motion';\nexport const T = () => <motion.div transition={{ duration: 0.3 }} />;",
    },
    stdout:
      '<dir>/src/Toast.tsx\texport const T = () => <motion.div transition={{ duration: 0.3 }} />;\n<dir>/src/Bad.css\t.x { transition: all 300ms ease; }\n',
  },
  invalid: { args: ['no-such-root'], exit: 0 },
});
