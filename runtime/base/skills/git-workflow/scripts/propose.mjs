#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const HELP = `Usage: propose.mjs [--project-root <path>]

Reads the repo history with git and gh and proposes the git workflow files as JSON, with
evidence, choices and unknown lines. Writes nothing (runs paqad-ai git-workflow setup).

Flags:
  --project-root <path>  the project root (default: the current folder)
  --help                 print this help

Prints JSON. Exits 0 on success, 1 on invalid input, 2 when paqad-ai, git or gh failed.
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

for (let index = 0; index < argv.length; index += 1) {
  if (argv[index] !== '--project-root')
    fail(`Unknown argument ${argv[index]}. Expected --project-root <path>.`);
  if (!argv[index + 1] || argv[index + 1].startsWith('--')) fail('--project-root needs a path.');
  index += 1;
}

const args = ['git-workflow', ...['setup'], ...argv];

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
