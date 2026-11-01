import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/test-execution-feedback-loop/scripts/load-failures.sh',
  names: [
    'load-failures help',
    'load-failures invalid input',
    'load-failures fixture output',
    'load-failures idempotency',
    'load-failures dry run',
    'load-failures output size',
    'load-failures secrets',
  ],
  fixture: {
    args: ['{dir}/e.json'],
    files: {
      'e.json':
        '{"schema_version":"1.0.0","gates":[{"name":"tests","status":"fail","failures":[{"category":"test-failure","file":"src/a.ts","line":42,"ac_id":"AC-1.1","test_id":"T1.1","suite":"auth","message":"expected 200"},{"category":"test-failure","file":"src/b.ts","line":7,"ac_id":"AC-2.1","test_id":"T2.1","suite":"invites","message":"expected 401"}]}]}',
    },
    stdout:
      '{"idx":1,"gate":"tests","category":"test-failure","file":"src/a.ts","line":42,"ac_id":"AC-1.1","test_id":"T1.1","suite":"auth","message":"expected 200"}\n{"idx":2,"gate":"tests","category":"test-failure","file":"src/b.ts","line":7,"ac_id":"AC-2.1","test_id":"T2.1","suite":"invites","message":"expected 401"}\n',
  },
  invalid: { args: ['/no/such/evidence.json'], exit: 1 },
});
