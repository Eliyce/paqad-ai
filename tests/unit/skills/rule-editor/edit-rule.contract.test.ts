import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/rule-editor/scripts/edit-rule.mjs',
  names: [
    'edit-rule help',
    'edit-rule invalid input',
    'edit-rule fixture output',
    'edit-rule idempotency',
    'edit-rule dry run',
    'edit-rule output size',
    'edit-rule secrets',
  ],
  fixture: {
    args: ['add', '.', 'docs/instructions/rules/general.md', 'Keep functions small.'],
    files: {
      'docs/instructions/rules/general.md':
        '# Rules\n\n- Never commit secrets to the repository. <!-- @rule RL-41db -->\n- Always use named exports. <!-- @rule RL-c895 -->\n',
      'docs/instructions/rules/rule-script-map.yml':
        'schema_version: 1\ngenerated_at: 2026-11-01T21:51:27.222Z\nrule_files_hash: sha256-132b51360fb6a24d8e8f2ea4f5d36c509b2fc7becb9c5a053ed2a65191e61726\nrules:\n  - id: RL-41db\n    source: docs/instructions/rules/general.md\n    text: Never commit secrets to the repository.\n    text_hash: 34511637e306def8fd241001e2cd1dc21df84f274928f7727d3f44d6b098652b\n    verifiability: deterministic\n    enforced_by: []\n    scripts: []\n  - id: RL-c895\n    source: docs/instructions/rules/general.md\n    text: Always use named exports.\n    text_hash: a59e71c1a048cc77625daf0b66dc333eab424c98030c707888d212bfd5174905\n    verifiability: unverifiable\n    enforced_by: []\n    scripts: []\n',
    },
    stdout:
      '{\n  "mode": "add",\n  "id": "RL-e85f",\n  "source": "docs/instructions/rules/general.md",\n  "text": "Keep functions small.",\n  "text_hash": "3ab2756aa7ccc9b087b797d018606826de3183e13704146d8c7e7ab5c6c59fd7",\n  "snapshot_path": ".paqad/scripts/rules/.history/<volatile>.yml",\n  "applied_at": "<volatile>",\n  "map_synced": true\n}\n',
  },
  invalid: {
    args: ['edit', '.', 'RL-0000', 'x'],
    files: {
      'docs/instructions/rules/general.md':
        '# Rules\n\n- Never commit secrets to the repository. <!-- @rule RL-41db -->\n- Always use named exports. <!-- @rule RL-c895 -->\n',
      'docs/instructions/rules/rule-script-map.yml':
        'schema_version: 1\ngenerated_at: 2026-11-01T21:51:27.222Z\nrule_files_hash: sha256-132b51360fb6a24d8e8f2ea4f5d36c509b2fc7becb9c5a053ed2a65191e61726\nrules:\n  - id: RL-41db\n    source: docs/instructions/rules/general.md\n    text: Never commit secrets to the repository.\n    text_hash: 34511637e306def8fd241001e2cd1dc21df84f274928f7727d3f44d6b098652b\n    verifiability: deterministic\n    enforced_by: []\n    scripts: []\n  - id: RL-c895\n    source: docs/instructions/rules/general.md\n    text: Always use named exports.\n    text_hash: a59e71c1a048cc77625daf0b66dc333eab424c98030c707888d212bfd5174905\n    verifiability: unverifiable\n    enforced_by: []\n    scripts: []\n',
    },
    exit: 1,
  },
  volatile: [
    new RegExp(
      '\\d{4}-\\d{2}-\\d{2}T\\d{2}[-:]\\d{2}[-:]\\d{2}[-.]\\d{3}Z(?:-[A-Za-z0-9_-]+?-\\d+-\\d+)?',
      'gu',
    ),
  ],
  writes: [
    '.paqad',
    'docs/instructions/rules/general.md',
    'docs/instructions/rules/rule-script-map.yml',
  ],
  rerun: 'fresh-dir',
});
