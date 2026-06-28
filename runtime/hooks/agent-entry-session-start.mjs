#!/usr/bin/env node
// agent-entry-session-start.mjs — SessionStart hook (cross-platform port of
// agent-entry-session-start.sh, #240).
//
// Every new session must start ungated — delete the sentinel so the agent is
// forced to load its provider entry file again. Always best-effort; always exits 0.

import { rmSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

import { resolveProjectRoot } from './lib/paqad-disabled.mjs';

try {
  rmSync(join(resolveProjectRoot(), '.paqad', '.agent-entry-loaded'), { force: true });
} catch {
  // best-effort; never fail a session start.
}
process.exit(0);
