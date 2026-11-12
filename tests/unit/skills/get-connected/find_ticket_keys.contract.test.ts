import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/claude-plugin/skills/get-connected/scripts/find_ticket_keys.py',
  names: [
    'find_ticket_keys help',
    'find_ticket_keys invalid input',
    'find_ticket_keys fixture output',
    'find_ticket_keys idempotency',
    'find_ticket_keys dry run',
    'find_ticket_keys output size',
    'find_ticket_keys secrets',
  ],
  fixture: {
    stdin:
      'feat/ABC-12-pause-plans\nABC-13 let customers pause longer\nfix ABC-14 refund rounding (#41)\nchore: bump deps\n',
    stdout:
      '{"github_refs": 1, "jira_prefixes": [{"count": 3, "examples": ["ABC-12", "ABC-13", "ABC-14"], "prefix": "ABC"}], "lines_read": 4}\n',
  },
  invalid: { args: ['--unknown-flag'], exit: 2 },
});
