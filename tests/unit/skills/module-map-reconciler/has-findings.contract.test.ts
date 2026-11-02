import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/module-map-reconciler/scripts/has-findings.sh',
  names: [
    'has-findings help',
    'has-findings invalid input',
    'has-findings fixture output',
    'has-findings idempotency',
    'has-findings dry run',
    'has-findings output size',
    'has-findings secrets',
  ],
  fixture: {
    args: ['{dir}'],
    files: {
      '.paqad/module-map/drift.json':
        '{"generated_at":"","source_roots":["src"],"findings":[{"code":"MM-ADD","paths":[],"module_slug":null,"feature_slug":null,"detail":""},{"code":"MM-DOC-MISSING","paths":[],"module_slug":"x","feature_slug":null,"detail":""}],"blocked":null,"counts":{"MM-ADD":1,"MM-FEAT-ADD":0,"MM-REMOVE":0,"MM-RENAME":0,"MM-FEAT-STALE":0,"MM-DOC-ORPHAN":0,"MM-DOC-MISSING":1,"MM-MISMATCH":0}}',
    },
    stdout: '2\n',
  },
  invalid: {
    args: ['{dir}'],
    files: {
      '.paqad/module-map/drift.json':
        '{"generated_at":"","source_roots":[],"findings":[],"blocked":"source_roots_unknown","counts":{"MM-ADD":0,"MM-FEAT-ADD":0,"MM-REMOVE":0,"MM-RENAME":0,"MM-FEAT-STALE":0,"MM-DOC-ORPHAN":0,"MM-DOC-MISSING":0,"MM-MISMATCH":0}}',
    },
    exit: 2,
  },
});
