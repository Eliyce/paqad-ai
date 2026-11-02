import { describeContract } from '../_helpers/contract.js';

describeContract({
  script:
    'runtime/capabilities/coding/skills/component-conformance-review/scripts/derive-inventory.sh',
  names: [
    'derive-inventory help',
    'derive-inventory invalid input',
    'derive-inventory fixture output',
    'derive-inventory idempotency',
    'derive-inventory dry run',
    'derive-inventory output size',
    'derive-inventory secrets',
  ],
  fixture: {
    args: ['{dir}/src/components'],
    files: {
      'src/components/Button.tsx': 'export const Button = () => null;',
      'src/components/Card.jsx': 'export const Card = () => null;',
      'src/components/Input.tsx': 'export const Input = () => null;',
    },
    stdout:
      'Button\t<dir>/src/components/Button.tsx\nCard\t<dir>/src/components/Card.jsx\nInput\t<dir>/src/components/Input.tsx\n',
  },
  invalid: { args: ['no-such-root'], exit: 0 },
});
