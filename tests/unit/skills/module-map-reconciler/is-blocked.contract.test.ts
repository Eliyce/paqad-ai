import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/module-map-reconciler/scripts/is-blocked.sh',
  names: [
    'is-blocked help',
    'is-blocked invalid input',
    'is-blocked fixture output',
    'is-blocked idempotency',
    'is-blocked dry run',
    'is-blocked output size',
    'is-blocked secrets',
  ],
  fixture: {
    args: ['{dir}'],
    files: {
      '.paqad/module-map/drift.json':
        '{"generated_at":"","source_roots":["src"],"findings":[],"blocked":null,"counts":{"MM-ADD":0,"MM-FEAT-ADD":0,"MM-REMOVE":0,"MM-RENAME":0,"MM-FEAT-STALE":0,"MM-DOC-ORPHAN":0,"MM-DOC-MISSING":0,"MM-MISMATCH":0}}',
    },
    stdout: 'none\n',
  },
  invalid: { args: ['{dir}'], exit: 2 },
});
