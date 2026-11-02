import { describeContract } from '../_helpers/contract.js';

describeContract({
  script:
    'runtime/capabilities/security/skills/dependency-advisory-triage/scripts/normalize-advisories.sh',
  names: [
    'normalize-advisories help',
    'normalize-advisories invalid input',
    'normalize-advisories fixture output',
    'normalize-advisories idempotency',
    'normalize-advisories dry run',
    'normalize-advisories output size',
    'normalize-advisories secrets',
  ],
  fixture: {
    args: ['npm-audit.json'],
    files: {
      'npm-audit.json':
        '{"vulnerabilities":{"lodash":{"name":"lodash","severity":"high","range":"<4.17.21","via":[{"source":1065,"title":"Prototype pollution","url":"https://github.com/advisories/GHSA-p6mc"}]}}}',
    },
    stdout:
      '{"ecosystem":"npm","package":"lodash","version":"<4.17.21","advisory_id":"https://github.com/advisories/GHSA-p6mc","severity":"high","title":"Prototype pollution","sources":["npm-audit.json"]}\n',
  },
  invalid: { args: [], exit: 2 },
});
