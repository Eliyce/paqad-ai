#!/usr/bin/env node

import process from 'node:process';

import { emitContext } from './lib/context-seam-emit.mjs';

let done = false;
const chunks = [];
const run = () => {
  if (done) return;
  done = true;
  emitContext(Buffer.concat(chunks).toString('utf8'));
};

process.stdin.on('data', (chunk) => chunks.push(chunk));
process.stdin.on('end', run);
process.stdin.on('error', run);
process.stdin.resume();
