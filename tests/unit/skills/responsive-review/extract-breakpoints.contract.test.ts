import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/capabilities/coding/skills/responsive-review/scripts/extract-breakpoints.sh',
  names: [
    'extract-breakpoints help',
    'extract-breakpoints invalid input',
    'extract-breakpoints fixture output',
    'extract-breakpoints idempotency',
    'extract-breakpoints dry run',
    'extract-breakpoints output size',
    'extract-breakpoints secrets',
  ],
  fixture: {
    args: ['{dir}/r.md'],
    files: {
      'r.md':
        '# Responsive\n\nSome prose about responsiveness.\n\n- sm: 640\n- not a breakpoint\n- minimum tap area: 24x24 CSS pixels\n- xl: 1280',
    },
    stdout: 'sm\t640\nxl\t1280\n',
  },
  invalid: { args: [], exit: 2 },
});
