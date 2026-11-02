import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/capabilities/coding/skills/design-system-coverage/scripts/derive-tier.sh',
  names: [
    'derive-tier help',
    'derive-tier invalid input',
    'derive-tier fixture output',
    'derive-tier idempotency',
    'derive-tier dry run',
    'derive-tier output size',
    'derive-tier secrets',
  ],
  fixture: {
    args: [],
    stdin:
      'docs/instructions/design-system/tokens.md\t8\ndocs/instructions/design-system/components.md\t3\ndocs/instructions/design-system/accessibility.md\t2\ndocs/instructions/design-system/responsive.md\t0\ndocs/instructions/design-system/motion.md\t1\ndocs/instructions/design-system/patterns.md\t0',
    stdout: 'tier=adequate\n',
  },
  invalid: { args: [], stdin: 'docs/instructions/design-system/tokens.md\tNaN', exit: 2 },
});
