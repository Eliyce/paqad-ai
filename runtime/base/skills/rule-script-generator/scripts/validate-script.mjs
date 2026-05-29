#!/usr/bin/env node
// Purpose: Validate a generated rule script before it is registered — parse its
//          header, then run it against its __fixtures__/pass and /fail. A script
//          that fails here is REJECTED and must not be added to the map.
// Usage:   node scripts/validate-script.mjs <script-path>
// Output:  JSON { accepted, header_errors, fixtures } on stdout.
// Exit:    0 if accepted, 1 if rejected.
import { readFileSync } from 'node:fs';

import { parseScriptHeader, runFixtures } from 'paqad-ai/rule-scripts';

const scriptPath = process.argv[2];
if (!scriptPath || scriptPath === '--help' || scriptPath === '-h') {
  process.stdout.write('Usage: node scripts/validate-script.mjs <script-path>\n');
  process.exit(scriptPath ? 0 : 1);
}

const header = parseScriptHeader(readFileSync(scriptPath, 'utf8'));
const fixtures = runFixtures(scriptPath);
// A missing declared binary means the script never actually ran — defer
// (re-validate on a host that has the dependency), don't reject.
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
// Exit 2 = deferred (env), 1 = rejected (logic/header), 0 = accepted.
process.exit(accepted ? 0 : deferred ? 2 : 1);
