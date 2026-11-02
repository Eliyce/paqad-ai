import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/capabilities/coding/skills/accessibility-review/scripts/map-axe-to-wcag.sh',
  names: [
    'map-axe-to-wcag help',
    'map-axe-to-wcag invalid input',
    'map-axe-to-wcag fixture output',
    'map-axe-to-wcag idempotency',
    'map-axe-to-wcag dry run',
    'map-axe-to-wcag output size',
    'map-axe-to-wcag secrets',
  ],
  fixture: { args: ['label'], stdout: 'WCAG-2.2-1.3.1\n' },
  invalid: { args: [], exit: 2 },
});
