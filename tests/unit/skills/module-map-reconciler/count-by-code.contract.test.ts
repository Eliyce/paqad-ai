import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/module-map-reconciler/scripts/count-by-code.sh',
  names: [
    'count-by-code help',
    'count-by-code invalid input',
    'count-by-code fixture output',
    'count-by-code idempotency',
    'count-by-code dry run',
    'count-by-code output size',
    'count-by-code secrets',
  ],
  fixture: {
    args: ['{dir}'],
    files: {
      '.paqad/module-map/drift.json':
        '{"generated_at":"","source_roots":["src"],"findings":[],"blocked":null,"counts":{"MM-ADD":3,"MM-FEAT-ADD":0,"MM-REMOVE":0,"MM-RENAME":0,"MM-FEAT-STALE":0,"MM-DOC-ORPHAN":0,"MM-DOC-MISSING":1,"MM-MISMATCH":0}}',
    },
    stdout: 'MM-ADD: 3\nMM-DOC-MISSING: 1\n',
  },
  invalid: { args: ['no-such-root'], exit: 2 },
});
