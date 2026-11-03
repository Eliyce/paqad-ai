#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const HELP = `Usage: change.mjs --plan <change.json> | --apply <change.json> [--project-root <path>]

Plans or applies the edits in change.json, keeping comments and key order
(runs paqad-ai git-workflow change).

Flags:
  --plan <change.json>   print the diff and the validation result, and write nothing
  --apply <change.json>  write the edits
  --project-root <path>  the project root (default: the current folder)
  --help                 print this help

Prints JSON. Exits 0 on success, 1 on invalid edits or files, 2 when paqad-ai failed.
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

let mode = 0;
for (let index = 0; index < argv.length; index += 1) {
  const flag = argv[index];
  if (flag !== '--plan' && flag !== '--apply' && flag !== '--project-root') {
    fail(
      `Unknown argument ${flag}. Expected --plan <change.json>, --apply <change.json> or --project-root <path>.`,
    );
  }
  if (!argv[index + 1] || argv[index + 1].startsWith('--')) fail(`${flag} needs a path.`);
  if (flag !== '--project-root') mode += 1;
  index += 1;
}
if (mode !== 1) fail('Pass exactly one of --plan <change.json> or --apply <change.json>.');

const args = ['git-workflow', ...['change'], ...argv];

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
