#!/usr/bin/env node

import { dirname, resolve } from 'node:path';
import process from 'node:process';

import { stagePluginEval } from './lib/plugin-eval-stage.mjs';

const target = process.argv[2];
if (!target) {
  process.stderr.write('usage: node scripts/stage-plugin-eval.mjs <dir>\n');
  process.exit(1);
}
try {
  const repoRoot = resolve(dirname(import.meta.filename), '..');
  process.stdout.write(`${stagePluginEval(repoRoot, target)}\n`);
} catch (error) {
  process.stderr.write(`${error.name}: ${error.message}\n`);
  process.exit(1);
}
