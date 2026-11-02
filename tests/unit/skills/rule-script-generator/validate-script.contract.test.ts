import { describeContract } from '../_helpers/contract.js';

describeContract({
  script: 'runtime/base/skills/rule-script-generator/scripts/validate-script.mjs',
  names: [
    'validate-script help',
    'validate-script invalid input',
    'validate-script fixture output',
    'validate-script idempotency',
    'validate-script dry run',
    'validate-script output size',
    'validate-script secrets',
  ],
  fixture: {
    args: ['.paqad/scripts/rules/general/001-no-secrets.mjs'],
    files: {
      '.paqad/scripts/rules/general/001-no-secrets.mjs':
        "// @paqad-rule-script\n// rule_id: RL-41db\n// source: docs/instructions/rules/general.md\n// kind: deterministic\n// scope: changed-files\n// runtime: node\nimport { readFileSync } from 'node:fs';\nimport { join } from 'node:path';\nconst { projectRoot, files } = JSON.parse(readFileSync(0, 'utf8'));\nconst findings = [];\nfor (const file of files) {\n  readFileSync(join(projectRoot, file), 'utf8').split('\\n').forEach((line, i) => {\n    if (/SECRET=/.test(line)) findings.push({ file, line: i + 1, message: 'secret committed', severity: 'blocker' });\n  });\n}\nprocess.stdout.write(JSON.stringify({ rule_id: 'RL-41db', kind: 'deterministic', findings }));\n",
      '.paqad/scripts/rules/general/001-no-secrets/__fixtures__/pass/a.env': 'name=app\n',
      '.paqad/scripts/rules/general/001-no-secrets/__fixtures__/fail/a.env': 'SECRET=x\n',
    },
    stdout:
      '{\n  "accepted": true,\n  "deferred": false,\n  "header_errors": [],\n  "fixtures": {\n    "passed": true,\n    "pass_fixtures": 1,\n    "fail_fixtures": 1,\n    "failures": [],\n    "missing_fixtures": false\n  }\n}\n',
  },
  invalid: {
    args: ['.paqad/scripts/rules/general/001-no-secrets.mjs'],
    files: { '.paqad/scripts/rules/general/001-no-secrets.mjs': 'export {};\n' },
    exit: 1,
  },
});
