#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const VERB = ['setup', '--apply'];
const args = ['git-workflow', ...VERB, ...process.argv.slice(2)];

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
