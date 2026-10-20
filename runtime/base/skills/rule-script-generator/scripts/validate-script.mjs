#!/usr/bin/env node
import { readFileSync } from 'node:fs';

import { parseScriptHeader, runFixtures } from 'paqad-ai/rule-scripts';

const scriptPath = process.argv[2];
if (!scriptPath || scriptPath === '--help' || scriptPath === '-h') {
  process.stdout.write('Usage: node scripts/validate-script.mjs <script-path>\n');
  process.exit(scriptPath ? 0 : 1);
}

const header = parseScriptHeader(readFileSync(scriptPath, 'utf8'));
const fixtures = runFixtures(scriptPath);
const deferred = (fixtures.missing_binaries ?? []).length > 0;
const accepted = header.ok && fixtures.passed && !deferred;

process.stdout.write(
  `${JSON.stringify(
    {
      accepted,
      deferred,
      header_errors: header.errors,
      fixtures,
    },
    null,
    2,
  )}\n`,
);
process.exit(accepted ? 0 : deferred ? 2 : 1);
