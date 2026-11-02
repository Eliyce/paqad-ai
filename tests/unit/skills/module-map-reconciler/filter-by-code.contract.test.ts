import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/module-map-reconciler/scripts/filter-by-code.sh',
  names: [
    'filter-by-code help',
    'filter-by-code invalid input',
    'filter-by-code fixture output',
    'filter-by-code idempotency',
    'filter-by-code dry run',
    'filter-by-code output size',
    'filter-by-code secrets',
  ],
  fixture: {
    args: ['MM-ADD', '{dir}'],
    files: {
      '.paqad/module-map/drift.json':
        '{"generated_at":"","source_roots":["src"],"findings":[{"code":"MM-ADD","module_slug":null,"feature_slug":null,"paths":["src/x.ts"],"detail":"x"},{"code":"MM-DOC-MISSING","module_slug":"y","feature_slug":null,"paths":[],"detail":"y"},{"code":"MM-ADD","module_slug":null,"feature_slug":null,"paths":["src/z.ts"],"detail":"z"}],"blocked":null,"counts":{"MM-ADD":2,"MM-FEAT-ADD":0,"MM-REMOVE":0,"MM-RENAME":0,"MM-FEAT-STALE":0,"MM-DOC-ORPHAN":0,"MM-DOC-MISSING":1,"MM-MISMATCH":0}}',
    },
    stdout:
      '[{"code":"MM-ADD","module_slug":null,"feature_slug":null,"paths":["src/x.ts"],"detail":"x"},{"code":"MM-ADD","module_slug":null,"feature_slug":null,"paths":["src/z.ts"],"detail":"z"}]',
  },
  invalid: { args: [], exit: 2 },
});
