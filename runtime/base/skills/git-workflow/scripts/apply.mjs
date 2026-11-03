#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const HELP = `Usage: apply.mjs <answers.json> [--overwrite] [--dry-run] [--project-root <path>]

Applies the answers in answers.json and writes the five git workflow files
(runs paqad-ai git-workflow setup --apply).

Arguments:
  <answers.json>         the answers file, started from assets/answers.template.json

Flags:
  --overwrite            replace git workflow files that already exist
  --dry-run              print the diff and the validation result, and write nothing
  --project-root <path>  the project root (default: the current folder)
  --help                 print this help

Prints JSON. Exits 0 on success, 1 on invalid answers or files, 2 when paqad-ai, git or gh failed.
`;

const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) {
  process.stdout.write(HELP);
  process.exit(0);
}

function fail(message) {
  process.stdout.write(
    `${JSON.stringify({ error: message, expected: HELP.split('\n')[0] }, null, 2)}\n`,
  );
  process.exit(1);
}

if (argv.length === 0 || argv[0].startsWith('--'))
  fail('Pass the answers file first: apply.mjs <answers.json>.');
const known = new Set(['--overwrite', '--dry-run', '--project-root']);
for (let index = 1; index < argv.length; index += 1) {
  if (!known.has(argv[index]))
    fail(
      `Unknown argument ${argv[index]}. Expected --overwrite, --dry-run or --project-root <path>.`,
    );
  if (argv[index] === '--project-root') {
    if (!argv[index + 1] || argv[index + 1].startsWith('--')) fail('--project-root needs a path.');
    index += 1;
  }
}

const args = ['git-workflow', ...['setup', '--apply'], ...argv];

function run(command, commandArgs) {
  return spawnSync(command, commandArgs, { stdio: 'inherit', shell: process.platform === 'win32' });
}

let result = run('paqad-ai', args);
if (result.error && result.error.code === 'ENOENT') {
  result = run('npx', ['--no-install', 'paqad-ai', ...args]);
}
if (result.error) {
  process.stderr.write(`paqad-ai could not be started: ${result.error.message}\n`);
  process.exit(2);
}
process.exit(result.status ?? 2);
