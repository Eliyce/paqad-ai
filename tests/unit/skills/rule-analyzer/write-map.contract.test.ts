import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/rule-analyzer/scripts/write-map.mjs',
  names: [
    'write-map help',
    'write-map invalid input',
    'write-map fixture output',
    'write-map idempotency',
    'write-map dry run',
    'write-map output size',
    'write-map secrets',
  ],
  fixture: {
    args: ['.', 'c.json'],
    files: {
      'docs/instructions/rules/general.md':
        '# Rules\n\n- Never commit secrets to the repository. <!-- @rule RL-41db -->\n- Always use named exports. <!-- @rule RL-c895 -->\n',
      'c.json':
        '[{"id": "RL-41db", "verifiability": "deterministic"}, {"id": "RL-c895", "verifiability": "unverifiable"}]',
    },
    stdout:
      '{\n  "snapshot_path": ".paqad/scripts/rules/.history/<volatile>.yml",\n  "applied_at": "<volatile>",\n  "rule_count": 2\n}\n',
  },
  invalid: { args: ['.', 'missing.json'], exit: 1 },
  volatile: [
    new RegExp(
      '\\d{4}-\\d{2}-\\d{2}T\\d{2}[-:]\\d{2}[-:]\\d{2}[-.]\\d{3}Z(?:-[A-Za-z0-9_-]+?-\\d+-\\d+)?',
      'gu',
    ),
  ],
  writes: ['.paqad', 'docs/instructions/rules/rule-script-map.yml'],
  rerun: 'fresh-dir',
});
