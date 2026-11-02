import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/rule-analyzer/scripts/record-conflicts.mjs',
  names: [
    'record-conflicts help',
    'record-conflicts invalid input',
    'record-conflicts fixture output',
    'record-conflicts idempotency',
    'record-conflicts dry run',
    'record-conflicts output size',
    'record-conflicts secrets',
  ],
  fixture: {
    args: ['.', 'conflicts.json'],
    files: {
      'docs/instructions/rules/general.md':
        '# Rules\n\n- Never commit secrets to the repository. <!-- @rule RL-41db -->\n- Always use named exports. <!-- @rule RL-c895 -->\n',
      'docs/instructions/rules/rule-script-map.yml':
        'schema_version: 1\ngenerated_at: 2026-11-01T21:51:27.222Z\nrule_files_hash: sha256-132b51360fb6a24d8e8f2ea4f5d36c509b2fc7becb9c5a053ed2a65191e61726\nrules:\n  - id: RL-41db\n    source: docs/instructions/rules/general.md\n    text: Never commit secrets to the repository.\n    text_hash: 34511637e306def8fd241001e2cd1dc21df84f274928f7727d3f44d6b098652b\n    verifiability: deterministic\n    enforced_by: []\n    scripts: []\n  - id: RL-c895\n    source: docs/instructions/rules/general.md\n    text: Always use named exports.\n    text_hash: a59e71c1a048cc77625daf0b66dc333eab424c98030c707888d212bfd5174905\n    verifiability: unverifiable\n    enforced_by: []\n    scripts: []\n',
      'conflicts.json':
        '[{"rule_ids": ["RL-41db", "RL-c895"], "message": "secrets rule and exports rule disagree"}]',
    },
    exit: 1,
    stdout:
      '{\n  "generated_at": "<volatile>",\n  "findings": [\n    {\n      "code": "RS-CONFLICT",\n      "rule_id": "RL-41db",\n      "message": "secrets rule and exports rule disagree (conflicting rules: RL-41db, RL-c895)"\n    }\n  ],\n  "counts": {\n    "RS-RULE-ADDED": 0,\n    "RS-RULE-EDITED": 0,\n    "RS-RULE-REMOVED": 0,\n    "RS-SCRIPT-STALE": 0,\n    "RS-FIXTURE-FAIL": 0,\n    "RS-CONFLICT": 1,\n    "RS-CACHE-INVALID": 0\n  },\n  "blocked": true\n}\n',
  },
  invalid: { args: ['.', 'missing.json'], exit: 1 },
  volatile: [
    new RegExp(
      '\\d{4}-\\d{2}-\\d{2}T\\d{2}[-:]\\d{2}[-:]\\d{2}[-.]\\d{3}Z(?:-[A-Za-z0-9_-]+?-\\d+-\\d+)?',
      'gu',
    ),
  ],
  writes: ['.paqad'],
  rerun: 'fresh-dir',
});
