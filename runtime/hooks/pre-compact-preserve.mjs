#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

let input = '';
process.stdin.on('data', (chunk) => {
  input += chunk;
});

process.stdin.on('end', () => {
  const parsed = JSON.parse(input || '{}');

  if (!parsed.output_path) {
    process.stderr.write(JSON.stringify({ message: 'pre-compact-preserve: missing output_path' }));
    process.exit(2);
  }

  mkdirSync(dirname(parsed.output_path), { recursive: true });
  writeFileSync(parsed.output_path, parsed.handoff || '');
  process.exit(0);
});
