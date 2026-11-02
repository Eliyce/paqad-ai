import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/capabilities/coding/skills/accessibility-review/scripts/static-a11y-scan.sh',
  names: [
    'static-a11y-scan help',
    'static-a11y-scan invalid input',
    'static-a11y-scan fixture output',
    'static-a11y-scan idempotency',
    'static-a11y-scan dry run',
    'static-a11y-scan output size',
    'static-a11y-scan secrets',
  ],
  fixture: {
    args: ['{dir}/src'],
    files: {
      'src/A.tsx': '<img src="hero.jpg" width="800" />',
      'src/B.tsx': '<button className="icon-only" />',
      'src/C.tsx': '<div tabIndex="3">hi</div>',
      'src/D.css': '.x { outline: none; }',
    },
    stdout:
      'img-no-alt\t<dir>/src/A.tsx:1\t<img src="hero.jpg" width="800" />\nbutton-no-name\t<dir>/src/B.tsx:1\t<button className="icon-only" />\noutline-zero\t<dir>/src/D.css:1\t.x { outline: none; }\npositive-tabindex\t<dir>/src/C.tsx:1\t<div tabIndex="3">hi</div>\n',
  },
  invalid: { args: ['no-such-root'], exit: 0 },
});
