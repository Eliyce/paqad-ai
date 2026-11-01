import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/decision/scripts/resolve.mjs',
  names: [
    'resolve help',
    'resolve invalid input',
    'resolve fixture output',
    'resolve idempotency',
    'resolve dry run',
    'resolve output size',
    'resolve secrets',
  ],
  fixture: {
    args: ['.', 'D-01M6CHG12NGDM9M5BGJCH1ZJA2', 'a', 'Redis fits'],
    files: {
      '.paqad/decisions/pending/D-01M6CHG12NGDM9M5BGJCH1ZJA2.json':
        '{\n  "id": "D-01M6CHG12NGDM9M5BGJCH1ZJA2",\n  "category": "scope",\n  "title": "Pick a cache",\n  "context": "Two options",\n  "options": [\n    {\n      "option_key": "a",\n      "label": "Redis"\n    },\n    {\n      "option_key": "b",\n      "label": "Memory"\n    }\n  ],\n  "recommendation": "a",\n  "created_at": "2026-11-01T21:50:50.453Z",\n  "status": "pending"\n}\n',
    },
    stdout: '{\n  "path": ".paqad/decisions/resolved/D-01M6CHG12NGDM9M5BGJCH1ZJA2.json"\n}\n',
  },
  invalid: { args: ['.', 'D-MISSING', 'a'], exit: 1 },
  writes: ['.paqad/decisions'],
  rerun: 'fresh-dir',
});
