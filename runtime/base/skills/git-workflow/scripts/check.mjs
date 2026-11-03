#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const HELP = `Usage: check.mjs [--accept] [--project-root <path>]

Validates the files in .paqad/configs/git-workflow/ and lists any changed outside the
git-workflow skill (runs paqad-ai git-workflow check).

Flags:
  --accept               accept the current files and restamp them when they are valid
  --project-root <path>  the project root (default: the current folder)
  --help                 print this help

Prints JSON. Exits 0 when valid, 1 on invalid files or input, 2 when paqad-ai, git or gh failed.
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

const known = new Set(['--accept', '--project-root']);
for (let index = 0; index < argv.length; index += 1) {
  if (!known.has(argv[index]))
    fail(`Unknown argument ${argv[index]}. Expected --accept or --project-root <path>.`);
  if (argv[index] === '--project-root') {
    if (!argv[index + 1] || argv[index + 1].startsWith('--')) fail('--project-root needs a path.');
    index += 1;
  }
}

const args = ['git-workflow', ...['check'], ...argv];

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
