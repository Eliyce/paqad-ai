import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/rule-script-generator/scripts/register-script.mjs',
  names: [
    'register-script help',
    'register-script invalid input',
    'register-script fixture output',
    'register-script idempotency',
    'register-script dry run',
    'register-script output size',
    'register-script secrets',
  ],
  fixture: {
    args: [
      '.',
      '.paqad/scripts/rules/general/001-no-secrets.mjs',
      'RL-41db',
      'deterministic',
      'changed-files',
    ],
    files: {
      'docs/instructions/rules/general.md':
        '# Rules\n\n- Never commit secrets to the repository. <!-- @rule RL-41db -->\n- Always use named exports. <!-- @rule RL-c895 -->\n',
      'docs/instructions/rules/rule-script-map.yml':
        'schema_version: 1\ngenerated_at: 2026-11-01T21:51:27.222Z\nrule_files_hash: sha256-132b51360fb6a24d8e8f2ea4f5d36c509b2fc7becb9c5a053ed2a65191e61726\nrules:\n  - id: RL-41db\n    source: docs/instructions/rules/general.md\n    text: Never commit secrets to the repository.\n    text_hash: 34511637e306def8fd241001e2cd1dc21df84f274928f7727d3f44d6b098652b\n    verifiability: deterministic\n    enforced_by: []\n    scripts: []\n  - id: RL-c895\n    source: docs/instructions/rules/general.md\n    text: Always use named exports.\n    text_hash: a59e71c1a048cc77625daf0b66dc333eab424c98030c707888d212bfd5174905\n    verifiability: unverifiable\n    enforced_by: []\n    scripts: []\n',
      '.paqad/scripts/rules/general/001-no-secrets.mjs':
        "// @paqad-rule-script\n// rule_id: RL-41db\n// source: docs/instructions/rules/general.md\n// kind: deterministic\n// scope: changed-files\n// runtime: node\nimport { readFileSync } from 'node:fs';\nimport { join } from 'node:path';\nconst { projectRoot, files } = JSON.parse(readFileSync(0, 'utf8'));\nconst findings = [];\nfor (const file of files) {\n  readFileSync(join(projectRoot, file), 'utf8').split('\\n').forEach((line, i) => {\n    if (/SECRET=/.test(line)) findings.push({ file, line: i + 1, message: 'secret committed', severity: 'blocker' });\n  });\n}\nprocess.stdout.write(JSON.stringify({ rule_id: 'RL-41db', kind: 'deterministic', findings }));\n",
      '.paqad/scripts/rules/general/001-no-secrets/__fixtures__/pass/a.env': 'name=app\n',
      '.paqad/scripts/rules/general/001-no-secrets/__fixtures__/fail/a.env': 'SECRET=x\n',
    },
    stdout:
      '{\n  "registered": true,\n  "fixtures": {\n    "passed": true,\n    "pass_fixtures": 1,\n    "fail_fixtures": 1,\n    "failures": [],\n    "missing_fixtures": false\n  },\n  "snapshot_path": ".paqad/scripts/rules/.history/<volatile>.yml",\n  "applied_at": "<volatile>"\n}\n',
  },
  invalid: {
    args: [
      '.',
      '.paqad/scripts/rules/general/001-no-secrets.mjs',
      'RL-41db',
      'deterministic',
      'changed-files',
    ],
    files: {
      'docs/instructions/rules/general.md':
        '# Rules\n\n- Never commit secrets to the repository. <!-- @rule RL-41db -->\n- Always use named exports. <!-- @rule RL-c895 -->\n',
      'docs/instructions/rules/rule-script-map.yml':
        'schema_version: 1\ngenerated_at: 2026-11-01T21:51:27.222Z\nrule_files_hash: sha256-132b51360fb6a24d8e8f2ea4f5d36c509b2fc7becb9c5a053ed2a65191e61726\nrules:\n  - id: RL-41db\n    source: docs/instructions/rules/general.md\n    text: Never commit secrets to the repository.\n    text_hash: 34511637e306def8fd241001e2cd1dc21df84f274928f7727d3f44d6b098652b\n    verifiability: deterministic\n    enforced_by: []\n    scripts: []\n  - id: RL-c895\n    source: docs/instructions/rules/general.md\n    text: Always use named exports.\n    text_hash: a59e71c1a048cc77625daf0b66dc333eab424c98030c707888d212bfd5174905\n    verifiability: unverifiable\n    enforced_by: []\n    scripts: []\n',
      '.paqad/scripts/rules/general/001-no-secrets.mjs': 'export {};\n',
    },
    exit: 1,
  },
  volatile: [
    new RegExp(
      '\\d{4}-\\d{2}-\\d{2}T\\d{2}[-:]\\d{2}[-:]\\d{2}[-.]\\d{3}Z(?:-[A-Za-z0-9_-]+?-\\d+-\\d+)?',
      'gu',
    ),
  ],
  writes: ['.paqad', 'docs/instructions/rules/rule-script-map.yml'],
  rerun: 'fresh-dir',
});
