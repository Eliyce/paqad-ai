import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/performance-regression-estimator/scripts/scan-perf-smells.sh',
  names: [
    'scan-perf-smells help',
    'scan-perf-smells invalid input',
    'scan-perf-smells fixture output',
    'scan-perf-smells idempotency',
    'scan-perf-smells dry run',
    'scan-perf-smells output size',
    'scan-perf-smells secrets',
  ],
  fixture: {
    args: ['{dir}/a.ts'],
    files: { 'a.ts': 'console.log("hello");\nconsole.info("hi");\nconsole.debug("dbg");' },
    stdout:
      'smell | file:line | excerpt\nlog-in-hot-path-candidate | <dir>/a.ts:1 | console.log("hello");\nlog-in-hot-path-candidate | <dir>/a.ts:2 | console.info("hi");\nlog-in-hot-path-candidate | <dir>/a.ts:3 | console.debug("dbg");\n',
  },
  invalid: { args: [], exit: 2 },
});
