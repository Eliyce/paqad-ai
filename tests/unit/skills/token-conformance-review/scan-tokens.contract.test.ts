import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/capabilities/coding/skills/token-conformance-review/scripts/scan-tokens.sh',
  names: [
    'scan-tokens help',
    'scan-tokens invalid input',
    'scan-tokens fixture output',
    'scan-tokens idempotency',
    'scan-tokens dry run',
    'scan-tokens output size',
    'scan-tokens secrets',
  ],
  fixture: {
    args: ['{dir}/src'],
    files: {
      'src/Color.tsx': "const c = '#1a73e8';",
      'src/Fn.tsx': 'const b = rgba(0, 0, 0, 0.4);',
      'src/Font.css': '.t { font-family: "Helvetica Neue", sans-serif; }',
      'src/Imp.css': '.z { color: red !important; }',
      'src/Inline.tsx': "<div style={{ color: '#fff' }} />",
      'src/Named.css': '.n { color: cornflowerblue; }',
      'src/Rem.css': '.y { padding: 1.25rem; }',
      'src/Spacing.css': '.x { margin: 24px; }',
      'src/Tw.tsx': '<div className="bg-[#1a73e8]" />',
    },
    stdout:
      'category | file:line | excerpt\ncolor-hex | <dir>/src/Color.tsx:1 | const c = \'#1a73e8\';\ncolor-hex | <dir>/src/Inline.tsx:1 | <div style={{ color: \'#fff\' }} />\ncolor-hex | <dir>/src/Tw.tsx:1 | <div className="bg-[#1a73e8]" />\ncolor-functional | <dir>/src/Fn.tsx:1 | const b = rgba(0, 0, 0, 0.4);\ntailwind-arbitrary-color | <dir>/src/Tw.tsx:1 | <div className="bg-[#1a73e8]" />\nraw-px | <dir>/src/Spacing.css:1 | .x { margin: 24px; }\nraw-rem-em | <dir>/src/Rem.css:1 | .y { padding: 1.25rem; }\ninline-style | <dir>/src/Inline.tsx:1 | <div style={{ color: \'#fff\' }} />\nimportant-override | <dir>/src/Imp.css:1 | .z { color: red !important; }\nraw-font-family | <dir>/src/Font.css:1 | .t { font-family: "Helvetica Neue", sans-serif; }\nnamed-css-color | <dir>/src/Imp.css:1 | .z { color: red !important; }\nnamed-css-color | <dir>/src/Named.css:1 | .n { color: cornflowerblue; }\n',
  },
  invalid: { args: ['no-such-root'], exit: 0 },
});
